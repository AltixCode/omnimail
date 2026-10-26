import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import eventBus from "@/server/event-bus";
import { imapWorkerPool } from "@/server/imap-worker";
import scheduledEmailWorker from "@/server/scheduled-worker";
import {
  parseCalendarInviteFromAttachments,
  getExistingEventRsvp,
} from "@/lib/calendar-invite";
import { getOrCreateDefaultUser } from "@/lib/user";
import { deduplicateThreadMessages } from "@/lib/message-deduplication";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;

    if (id.startsWith("sched_")) {
      const scheduledMessage = await scheduledEmailWorker.getScheduledEmailDetail(
        id,
        user.id,
      );
      if (!scheduledMessage) {
        return NextResponse.json({ error: "Scheduled email not found" }, { status: 404 });
      }
      return NextResponse.json({
        message: scheduledMessage,
        thread: [scheduledMessage],
      });
    }

    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            id: true,
            userId: true,
            label: true,
            emailAddress: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
            specialUse: true,
          },
        },
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
            contentId: true,
            dataBase64: true,
          },
        },
      },
    });

    if (!message || message.account.userId !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Resolve all messages belonging to this conversation / thread
    const threadConditions: any[] = [];
    if (message.threadId) {
      threadConditions.push({ threadId: message.threadId });
      threadConditions.push({ messageId: message.threadId });
    }
    if (message.messageId) {
      threadConditions.push({ threadId: message.messageId });
    }

    const cleanSubject = (message.subject || "")
      .replace(/^(re|fwd|fw):\s*/gi, "")
      .trim();
    if (threadConditions.length === 0 && cleanSubject.length > 2) {
      threadConditions.push({
        accountId: message.accountId,
        subject: {
          contains: cleanSubject,
          mode: "insensitive",
        },
      });
    }

    let threadMessages: (typeof message)[] = [message];

    if (threadConditions.length > 0) {
      const found = await prisma.message.findMany({
        where: {
          AND: [{ OR: threadConditions }, { account: { userId: user.id } }],
        },
        include: {
          account: {
            select: {
              id: true,
              userId: true,
              label: true,
              emailAddress: true,
            },
          },
          folder: {
            select: {
              id: true,
              name: true,
              path: true,
              specialUse: true,
            },
          },
          attachments: {
            select: {
              id: true,
              filename: true,
              contentType: true,
              size: true,
              contentId: true,
              dataBase64: true,
            },
          },
        },
        orderBy: { date: "asc" },
      });

      if (found.length > 0) {
        const map = new Map<string, typeof message>();
        for (const m of found) {
          map.set(m.id, m);
        }
        map.set(message.id, message);
        threadMessages = deduplicateThreadMessages(
          Array.from(map.values()),
          message.id,
        );
      }
    }

    // Enrich messages with calendar invite details and RSVP status
    const enrichMessageWithInvite = async (m: any) => {
      const invite = parseCalendarInviteFromAttachments(
        m.attachments || [],
        m.bodyText,
      );
      if (!invite) {
        return {
          ...m,
          calendarInvite: null,
          userRsvpStatus: "needs-action",
          calendarEventId: null,
        };
      }

      const userId = m.account?.userId || message.account.userId;
      const rsvp = await getExistingEventRsvp(userId, invite.uid);

      return {
        ...m,
        calendarInvite: invite,
        userRsvpStatus: rsvp.status,
        calendarEventId: rsvp.eventId || null,
      };
    };

    const enrichedMessage = await enrichMessageWithInvite(message);
    const enrichedThread = await Promise.all(
      threadMessages.map(enrichMessageWithInvite),
    );

    return NextResponse.json({
      message: enrichedMessage,
      thread: enrichedThread,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;
    const body = await req.json();

    if (id.startsWith("sched_")) {
      const cleanId = id.slice(6);
      const updated = await scheduledEmailWorker.updateScheduledEmail(
        cleanId,
        user.id,
        body,
      );
      return NextResponse.json({ success: true, message: updated });
    }

    const existing = await prisma.message.findUnique({
      where: { id },
      select: {
        id: true,
        uid: true,
        accountId: true,
        folderId: true,
        fromAddress: true,
        folder: {
          select: {
            path: true,
            specialUse: true,
            name: true,
          },
        },
        account: { select: { userId: true } },
      },
    });
    if (!existing || existing.account.userId !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const dataToUpdate: any = {};
    if (body.isRead !== undefined) dataToUpdate.isRead = Boolean(body.isRead);
    if (body.isStarred !== undefined)
      dataToUpdate.isStarred = Boolean(body.isStarred);

    const isMovingFolder = body.folderId && body.folderId !== existing.folderId;
    let targetFolder: any = null;

    if (isMovingFolder) {
      targetFolder = await prisma.folder.findFirst({
        where: { id: body.folderId, accountId: existing.accountId },
      });

      if (!targetFolder) {
        return NextResponse.json(
          { error: "Target folder not found in this account" },
          { status: 400 },
        );
      }

      dataToUpdate.folderId = targetFolder.id;
      const maxRecord = await prisma.message.findFirst({
        where: { folderId: targetFolder.id },
        orderBy: { uid: "desc" },
        select: { uid: true },
      });
      dataToUpdate.uid = Math.max((maxRecord?.uid || 0) + 1, 1000000);
    }

    const updated = await prisma.message.update({
      where: { id },
      data: dataToUpdate,
      include: {
        folder: true,
      },
    });

    // Update folder unread & total counts for target folder
    const [unreadCount, totalCount] = await Promise.all([
      prisma.message.count({
        where: { folderId: updated.folderId, isRead: false },
      }),
      prisma.message.count({ where: { folderId: updated.folderId } }),
    ]);

    await prisma.folder.update({
      where: { id: updated.folderId },
      data: { unreadCount, totalCount },
    });

    // If moved, also update old folder unread & total counts
    if (isMovingFolder && existing.folderId) {
      const [oldUnread, oldTotal] = await Promise.all([
        prisma.message.count({
          where: { folderId: existing.folderId, isRead: false },
        }),
        prisma.message.count({ where: { folderId: existing.folderId } }),
      ]);
      await prisma.folder.update({
        where: { id: existing.folderId },
        data: { unreadCount: oldUnread, totalCount: oldTotal },
      });
      eventBus.broadcast("folder-updated", {
        folderId: existing.folderId,
        unreadCount: oldUnread,
        totalCount: oldTotal,
      });
    }

    eventBus.broadcast("message-updated", {
      id: updated.id,
      folderId: updated.folderId,
      isRead: updated.isRead,
      isStarred: updated.isStarred,
    });

    eventBus.broadcast("folder-updated", {
      folderId: updated.folderId,
      unreadCount,
      totalCount,
    });

    // Handle IMAP remote move & Spam / Ham training
    if (isMovingFolder && existing.folder?.path && targetFolder?.path) {
      const wasInSpam =
        existing.folder.specialUse === "\\Junk" ||
        /spam|junk/i.test(existing.folder.name) ||
        /spam|junk/i.test(existing.folder.path);

      const isTargetInbox =
        targetFolder.specialUse === "\\Inbox" || targetFolder.path === "INBOX";

      const isTargetSpam =
        targetFolder.specialUse === "\\Junk" ||
        /spam|junk/i.test(targetFolder.name) ||
        /spam|junk/i.test(targetFolder.path);

      // Moving out of Spam to Inbox -> User reported Not Spam! Auto-whitelist sender
      if (wasInSpam && isTargetInbox) {
        let senderEmail = (existing.fromAddress || "").trim().toLowerCase();
        const mMatch = senderEmail.match(/<([^>]+)>/);
        if (mMatch && mMatch[1]) senderEmail = mMatch[1].trim().toLowerCase();
        if (senderEmail && senderEmail.includes("@")) {
          await prisma.trustedSender
            .upsert({
              where: {
                userId_email: {
                  userId: user.id,
                  email: senderEmail,
                },
              },
              update: {},
              create: {
                userId: user.id,
                email: senderEmail,
              },
            })
            .catch(() => {});
        }
      } else if (isTargetSpam) {
        let senderEmail = (existing.fromAddress || "").trim().toLowerCase();
        const mMatch = senderEmail.match(/<([^>]+)>/);
        if (mMatch && mMatch[1]) senderEmail = mMatch[1].trim().toLowerCase();
        if (senderEmail) {
          await prisma.trustedSender
            .deleteMany({
              where: {
                userId: user.id,
                email: senderEmail,
              },
            })
            .catch(() => {});
        }
      }

      if (typeof existing.uid === "number" && existing.uid < 1000000) {
        let imapAction = "move";
        if (
          targetFolder.specialUse === "\\Trash" ||
          /trash/i.test(targetFolder.name)
        ) {
          imapAction = "trash";
        } else if (
          targetFolder.specialUse === "\\Archive" ||
          /archive/i.test(targetFolder.name)
        ) {
          imapAction = "archive";
        } else if (isTargetInbox) {
          imapAction = "inbox";
        } else if (isTargetSpam) {
          imapAction = "spam";
        }

        imapWorkerPool
          .queueAction({
            accountId: existing.accountId,
            action: imapAction,
            folderPath: existing.folder.path,
            targetPath: targetFolder.path,
            uids: [existing.uid],
          })
          .catch((err) => console.warn("Queue action error:", err));
      }
    }

    // Queue IMAP action for read/star flags
    const activeUid = isMovingFolder ? existing.uid : updated.uid;
    const activeFolderPath = isMovingFolder
      ? existing.folder?.path
      : updated.folder?.path;

    if (
      activeFolderPath &&
      typeof activeUid === "number" &&
      activeUid < 1000000
    ) {
      if (body.isRead !== undefined) {
        imapWorkerPool
          .queueAction({
            accountId: updated.accountId,
            action: body.isRead ? "mark-read" : "mark-unread",
            folderPath: activeFolderPath,
            uids: [activeUid],
          })
          .catch((err) => console.warn("Queue action error:", err));
      }
      if (body.isStarred !== undefined) {
        imapWorkerPool
          .queueAction({
            accountId: updated.accountId,
            action: body.isStarred ? "star" : "unstar",
            folderPath: activeFolderPath,
            uids: [activeUid],
          })
          .catch((err) => console.warn("Queue action error:", err));
      }
    }

    return NextResponse.json({ success: true, message: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;

    if (id.startsWith("sched_")) {
      const cleanId = id.slice(6);
      await scheduledEmailWorker.deleteScheduledEmail(cleanId, user.id);
      return NextResponse.json({ success: true });
    }

    const message = await prisma.message.findUnique({
      where: { id },
      include: { folder: true, account: { select: { userId: true } } },
    });

    if (!message || message.account.userId !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const sourceFolderId = message.folderId;
    const sourceFolderPath = message.folder.path;

    // Check if message is already in Trash
    const isTrash =
      message.folder.specialUse === "\\Trash" ||
      message.folder.name.toLowerCase().includes("trash") ||
      message.folder.name.toLowerCase().includes("bin");

    if (isTrash) {
      // Hard delete
      await prisma.message.delete({ where: { id } });

      if (sourceFolderPath && typeof message.uid === "number") {
        await imapWorkerPool
          .queueAction({
            accountId: message.accountId,
            action: "delete",
            folderPath: sourceFolderPath,
            uids: [message.uid],
          })
          .catch((err) => console.warn("Queue action error:", err));
      }
    } else {
      // Find or create Trash folder
      let trashFolder = await prisma.folder.findFirst({
        where: {
          accountId: message.accountId,
          OR: [
            { specialUse: "\\Trash" },
            { name: { contains: "Trash", mode: "insensitive" } },
            { name: { contains: "Bin", mode: "insensitive" } },
          ],
        },
      });

      if (!trashFolder) {
        trashFolder = await prisma.folder.create({
          data: {
            accountId: message.accountId,
            name: "Trash",
            path: "Trash",
            specialUse: "\\Trash",
          },
        });
      }

      const maxRecord = await prisma.message.findFirst({
        where: { folderId: trashFolder.id },
        orderBy: { uid: "desc" },
        select: { uid: true },
      });
      const nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

      await prisma.message.update({
        where: { id },
        data: {
          folderId: trashFolder.id,
          uid: nextUid,
        },
      });

      if (sourceFolderPath && typeof message.uid === "number") {
        await imapWorkerPool
          .queueAction({
            accountId: message.accountId,
            action: "trash",
            folderPath: sourceFolderPath,
            targetPath: trashFolder.path,
            uids: [message.uid],
          })
          .catch((err) => console.warn("Queue action error:", err));
      }

      // Update destination folder counts
      const [destUnread, destTotal] = await Promise.all([
        prisma.message.count({
          where: { folderId: trashFolder.id, isRead: false },
        }),
        prisma.message.count({ where: { folderId: trashFolder.id } }),
      ]);
      await prisma.folder.update({
        where: { id: trashFolder.id },
        data: { unreadCount: destUnread, totalCount: destTotal },
      });
      eventBus.broadcast("folder-updated", {
        folderId: trashFolder.id,
        unreadCount: destUnread,
        totalCount: destTotal,
      });
    }

    // Update source folder counts
    const [srcUnread, srcTotal] = await Promise.all([
      prisma.message.count({
        where: { folderId: sourceFolderId, isRead: false },
      }),
      prisma.message.count({ where: { folderId: sourceFolderId } }),
    ]);
    await prisma.folder.update({
      where: { id: sourceFolderId },
      data: { unreadCount: srcUnread, totalCount: srcTotal },
    });
    eventBus.broadcast("folder-updated", {
      folderId: sourceFolderId,
      unreadCount: srcUnread,
      totalCount: srcTotal,
    });

    eventBus.broadcast("message-deleted", { id, folderId: sourceFolderId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
