import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import eventBus from "@/server/event-bus";
import { imapWorkerPool } from "@/server/imap-worker";
import { getOrCreateDefaultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

type BatchAction =
  | "mark-read"
  | "mark-unread"
  | "star"
  | "unstar"
  | "trash"
  | "archive"
  | "inbox"
  | "spam"
  | "delete"
  | "move";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();
    let { messageIds, action, folderId, targetFolderId } = body as {
      messageIds?: string[];
      action?: BatchAction;
      folderId?: string;
      targetFolderId?: string;
    };
    const destFolderId = folderId || targetFolderId;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json(
        { error: "messageIds must be a non-empty array of strings" },
        { status: 400 },
      );
    }

    if (
      !action ||
      ![
        "mark-read",
        "mark-unread",
        "star",
        "unstar",
        "trash",
        "archive",
        "inbox",
        "spam",
        "delete",
        "move",
      ].includes(action)
    ) {
      return NextResponse.json(
        { error: `Invalid action '${action}'` },
        { status: 400 },
      );
    }

    // Fetch existing messages to know their folders, accounts, and UIDs
    // (scoped to the authenticated user's own accounts only)
    const messages = await prisma.message.findMany({
      where: { id: { in: messageIds }, account: { userId: user.id } },
      select: {
        id: true,
        uid: true,
        accountId: true,
        folderId: true,
        fromAddress: true,
        isRead: true,
        isStarred: true,
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
            specialUse: true,
          },
        },
      },
    });

    if (messages.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // Re-scope messageIds to only the ones the user actually owns, so every
    // downstream updateMany/deleteMany below stays within their own mail.
    messageIds = messages.map((m) => m.id);

    const affectedFolderIds = new Set<string>();
    messages.forEach((m) => affectedFolderIds.add(m.folderId));

    // Group message IDs by accountId for account-specific folder moves
    const accountMap = new Map<string, string[]>();
    for (const m of messages) {
      if (!accountMap.has(m.accountId)) {
        accountMap.set(m.accountId, []);
      }
      accountMap.get(m.accountId)!.push(m.id);
    }

    // Helper to queue IMAP actions grouped by account and folder
    const queueImapForMessages = async (
      targetMessages: typeof messages,
      actionName: string,
      targetPath?: string | null,
    ) => {
      const groupMap = new Map<
        string,
        { accountId: string; folderPath: string; uids: number[] }
      >();
      for (const m of targetMessages) {
        if (!m.folder?.path || typeof m.uid !== "number") continue;
        const key = `${m.accountId}:${m.folder.path}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            accountId: m.accountId,
            folderPath: m.folder.path,
            uids: [],
          });
        }
        groupMap.get(key)!.uids.push(m.uid);
      }
      for (const group of groupMap.values()) {
        await imapWorkerPool
          .queueAction({
            accountId: group.accountId,
            action: actionName,
            folderPath: group.folderPath,
            targetPath: targetPath || null,
            uids: group.uids,
          })
          .catch((err) => console.warn("Queue action error:", err));
      }
    };

    switch (action) {
      case "mark-read": {
        await prisma.message.updateMany({
          where: { id: { in: messageIds } },
          data: { isRead: true },
        });
        messages.forEach((m) => {
          eventBus.broadcast("message-updated", {
            id: m.id,
            folderId: m.folderId,
            isRead: true,
            isStarred: m.isStarred,
          });
        });
        await queueImapForMessages(messages, "mark-read");
        break;
      }

      case "mark-unread": {
        await prisma.message.updateMany({
          where: { id: { in: messageIds } },
          data: { isRead: false },
        });
        messages.forEach((m) => {
          eventBus.broadcast("message-updated", {
            id: m.id,
            folderId: m.folderId,
            isRead: false,
            isStarred: m.isStarred,
          });
        });
        await queueImapForMessages(messages, "mark-unread");
        break;
      }

      case "star": {
        await prisma.message.updateMany({
          where: { id: { in: messageIds } },
          data: { isStarred: true },
        });
        messages.forEach((m) => {
          eventBus.broadcast("message-updated", {
            id: m.id,
            folderId: m.folderId,
            isRead: m.isRead,
            isStarred: true,
          });
        });
        await queueImapForMessages(messages, "star");
        break;
      }

      case "unstar": {
        await prisma.message.updateMany({
          where: { id: { in: messageIds } },
          data: { isStarred: false },
        });
        messages.forEach((m) => {
          eventBus.broadcast("message-updated", {
            id: m.id,
            folderId: m.folderId,
            isRead: m.isRead,
            isStarred: false,
          });
        });
        await queueImapForMessages(messages, "unstar");
        break;
      }

      case "trash": {
        for (const [accountId, ids] of accountMap.entries()) {
          let trashFolder = await prisma.folder.findFirst({
            where: {
              accountId,
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
                accountId,
                name: "Trash",
                path: "Trash",
                specialUse: "\\Trash",
              },
            });
          }

          affectedFolderIds.add(trashFolder.id);

          const messagesToMove = messages.filter(
            (m) => m.accountId === accountId && m.folderId !== trashFolder!.id,
          );
          const messagesAlreadyInTrash = messages.filter(
            (m) => m.accountId === accountId && m.folderId === trashFolder!.id,
          );

          if (messagesToMove.length > 0) {
            const maxRecord = await prisma.message.findFirst({
              where: { folderId: trashFolder.id },
              orderBy: { uid: "desc" },
              select: { uid: true },
            });
            let nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

            await Promise.all(
              messagesToMove.map((m, idx) =>
                prisma.message.update({
                  where: { id: m.id },
                  data: {
                    folderId: trashFolder!.id,
                    uid: nextUid + idx,
                  },
                }),
              ),
            );

            messagesToMove.forEach((m) => {
              eventBus.broadcast("message-updated", {
                id: m.id,
                folderId: trashFolder!.id,
              });
            });

            await queueImapForMessages(
              messagesToMove,
              "trash",
              trashFolder.path,
            );
          }

          if (messagesAlreadyInTrash.length > 0) {
            await prisma.message.deleteMany({
              where: { id: { in: messagesAlreadyInTrash.map((m) => m.id) } },
            });

            messagesAlreadyInTrash.forEach((m) => {
              eventBus.broadcast("message-deleted", {
                id: m.id,
                folderId: trashFolder!.id,
              });
            });

            await queueImapForMessages(messagesAlreadyInTrash, "delete");
          }
        }
        break;
      }

      case "archive": {
        for (const [accountId, ids] of accountMap.entries()) {
          let archiveFolder = await prisma.folder.findFirst({
            where: {
              accountId,
              OR: [
                { specialUse: "\\Archive" },
                { name: { contains: "Archive", mode: "insensitive" } },
                { path: { contains: "Archive", mode: "insensitive" } },
              ],
            },
          });

          if (!archiveFolder) {
            archiveFolder = await prisma.folder.create({
              data: {
                accountId,
                name: "Archive",
                path: "Archive",
                specialUse: "\\Archive",
              },
            });
          }

          affectedFolderIds.add(archiveFolder.id);

          const messagesToMove = messages.filter(
            (m) =>
              m.accountId === accountId && m.folderId !== archiveFolder!.id,
          );

          if (messagesToMove.length > 0) {
            const maxRecord = await prisma.message.findFirst({
              where: { folderId: archiveFolder.id },
              orderBy: { uid: "desc" },
              select: { uid: true },
            });
            let nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

            await Promise.all(
              messagesToMove.map((m, idx) =>
                prisma.message.update({
                  where: { id: m.id },
                  data: {
                    folderId: archiveFolder!.id,
                    uid: nextUid + idx,
                  },
                }),
              ),
            );

            messagesToMove.forEach((m) => {
              eventBus.broadcast("message-updated", {
                id: m.id,
                folderId: archiveFolder!.id,
              });
            });

            await queueImapForMessages(
              messagesToMove,
              "archive",
              archiveFolder.path,
            );
          }
        }
        break;
      }

      case "inbox": {
        for (const [accountId, ids] of accountMap.entries()) {
          const inboxFolder = await prisma.folder.findFirst({
            where: {
              accountId,
              OR: [
                { specialUse: "\\Inbox" },
                { path: "INBOX" },
                { name: "INBOX" },
              ],
            },
          });

          if (inboxFolder) {
            affectedFolderIds.add(inboxFolder.id);

            const messagesToMove = messages.filter(
              (m) => m.accountId === accountId && m.folderId !== inboxFolder.id,
            );

            if (messagesToMove.length > 0) {
              const maxRecord = await prisma.message.findFirst({
                where: { folderId: inboxFolder.id },
                orderBy: { uid: "desc" },
                select: { uid: true },
              });
              let nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

              await Promise.all(
                messagesToMove.map((m, idx) =>
                  prisma.message.update({
                    where: { id: m.id },
                    data: {
                      folderId: inboxFolder.id,
                      uid: nextUid + idx,
                    },
                  }),
                ),
              );

              messagesToMove.forEach((m) => {
                eventBus.broadcast("message-updated", {
                  id: m.id,
                  folderId: inboxFolder.id,
                });
              });

              // Not Spam training: if message was in Spam/Junk, auto-whitelist the sender
              const fromSpam = messagesToMove.filter(
                (m) =>
                  m.folder?.specialUse === "\\Junk" ||
                  /spam|junk/i.test(m.folder?.name || "") ||
                  /spam|junk/i.test(m.folder?.path || "")
              );
              for (const s of fromSpam) {
                let senderEmail = (s.fromAddress || "").trim().toLowerCase();
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
              }

              await queueImapForMessages(
                messagesToMove,
                "inbox",
                inboxFolder.path,
              );
            }
          }
        }
        break;
      }

      case "spam": {
        for (const [accountId, ids] of accountMap.entries()) {
          let spamFolder = await prisma.folder.findFirst({
            where: {
              accountId,
              OR: [
                { specialUse: "\\Junk" },
                { name: { contains: "Spam", mode: "insensitive" } },
                { path: { contains: "Spam", mode: "insensitive" } },
                { name: { contains: "Junk", mode: "insensitive" } },
                { path: { contains: "Junk", mode: "insensitive" } },
              ],
            },
          });

          if (!spamFolder) {
            spamFolder = await prisma.folder.create({
              data: {
                accountId,
                name: "Spam",
                path: "Spam",
                specialUse: "\\Junk",
              },
            });
          }

          affectedFolderIds.add(spamFolder.id);

          const messagesToMove = messages.filter(
            (m) => m.accountId === accountId && m.folderId !== spamFolder!.id,
          );

          if (messagesToMove.length > 0) {
            const maxRecord = await prisma.message.findFirst({
              where: { folderId: spamFolder.id },
              orderBy: { uid: "desc" },
              select: { uid: true },
            });
            let nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

            await Promise.all(
              messagesToMove.map((m, idx) =>
                prisma.message.update({
                  where: { id: m.id },
                  data: {
                    folderId: spamFolder!.id,
                    uid: nextUid + idx,
                  },
                }),
              ),
            );

            messagesToMove.forEach((m) => {
              eventBus.broadcast("message-updated", {
                id: m.id,
                folderId: spamFolder!.id,
              });
            });

            // Report Spam: remove senders from trustedSender if present
            for (const s of messagesToMove) {
              let senderEmail = (s.fromAddress || "").trim().toLowerCase();
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

            await queueImapForMessages(
              messagesToMove,
              "spam",
              spamFolder.path,
            );
          }
        }
        break;
      }

      case "move": {
        if (!destFolderId) {
          return NextResponse.json(
            { error: "folderId required for action 'move'" },
            { status: 400 },
          );
        }

        const targetFolder = await prisma.folder.findFirst({
          where: { id: destFolderId, account: { userId: user.id } },
        });

        if (!targetFolder) {
          return NextResponse.json(
            { error: "Target folder not found or unauthorized" },
            { status: 404 },
          );
        }

        affectedFolderIds.add(targetFolder.id);

        for (const [accountId, ids] of accountMap.entries()) {
          let accountTargetFolder = targetFolder;
          if (targetFolder.accountId !== accountId) {
            const matchingFolder = await prisma.folder.findFirst({
              where: {
                accountId,
                OR: [
                  ...(targetFolder.specialUse
                    ? [{ specialUse: targetFolder.specialUse }]
                    : []),
                  { name: targetFolder.name },
                  { path: targetFolder.path },
                ],
              },
            });
            if (matchingFolder) {
              accountTargetFolder = matchingFolder;
              affectedFolderIds.add(matchingFolder.id);
            } else {
              continue;
            }
          }

          const messagesToMove = messages.filter(
            (m) =>
              m.accountId === accountId && m.folderId !== accountTargetFolder.id,
          );

          if (messagesToMove.length > 0) {
            const maxRecord = await prisma.message.findFirst({
              where: { folderId: accountTargetFolder.id },
              orderBy: { uid: "desc" },
              select: { uid: true },
            });
            let nextUid = Math.max((maxRecord?.uid || 0) + 1, 1000000);

            await Promise.all(
              messagesToMove.map((m, idx) =>
                prisma.message.update({
                  where: { id: m.id },
                  data: {
                    folderId: accountTargetFolder.id,
                    uid: nextUid + idx,
                  },
                }),
              ),
            );

            messagesToMove.forEach((m) => {
              eventBus.broadcast("message-updated", {
                id: m.id,
                folderId: accountTargetFolder.id,
              });
            });

            const isTargetInbox =
              accountTargetFolder.specialUse === "\\Inbox" ||
              accountTargetFolder.path === "INBOX";

            const isTargetSpam =
              accountTargetFolder.specialUse === "\\Junk" ||
              /spam|junk/i.test(accountTargetFolder.name) ||
              /spam|junk/i.test(accountTargetFolder.path);

            if (isTargetInbox) {
              const fromSpam = messagesToMove.filter(
                (m) =>
                  m.folder?.specialUse === "\\Junk" ||
                  /spam|junk/i.test(m.folder?.name || "") ||
                  /spam|junk/i.test(m.folder?.path || "")
              );
              for (const s of fromSpam) {
                let senderEmail = (s.fromAddress || "").trim().toLowerCase();
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
              }
            } else if (isTargetSpam) {
              for (const s of messagesToMove) {
                let senderEmail = (s.fromAddress || "").trim().toLowerCase();
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
            }

            let imapAction = "move";
            if (
              accountTargetFolder.specialUse === "\\Trash" ||
              /trash/i.test(accountTargetFolder.name)
            ) {
              imapAction = "trash";
            } else if (
              accountTargetFolder.specialUse === "\\Archive" ||
              /archive/i.test(accountTargetFolder.name)
            ) {
              imapAction = "archive";
            } else if (isTargetInbox) {
              imapAction = "inbox";
            } else if (isTargetSpam) {
              imapAction = "spam";
            }

            await queueImapForMessages(
              messagesToMove,
              imapAction,
              accountTargetFolder.path,
            );
          }
        }
        break;
      }

      case "delete": {
        await prisma.message.deleteMany({
          where: { id: { in: messageIds } },
        });

        messages.forEach((m) => {
          eventBus.broadcast("message-deleted", {
            id: m.id,
            folderId: m.folderId,
          });
        });

        await queueImapForMessages(messages, "delete");
        break;
      }
    }

    // Recalculate unreadCount and totalCount for all affected folders
    await Promise.all(
      Array.from(affectedFolderIds).map(async (folderId) => {
        const [unreadCount, totalCount] = await Promise.all([
          prisma.message.count({ where: { folderId, isRead: false } }),
          prisma.message.count({ where: { folderId } }),
        ]);

        await prisma.folder.update({
          where: { id: folderId },
          data: { unreadCount, totalCount },
        });

        eventBus.broadcast("folder-updated", {
          folderId,
          unreadCount,
          totalCount,
        });
      }),
    );

    return NextResponse.json({ success: true, count: messageIds.length });
  } catch (error: any) {
    console.error("Batch message action error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
