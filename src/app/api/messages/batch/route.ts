import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import eventBus from "@/server/event-bus";

export const dynamic = "force-dynamic";

type BatchAction =
  | "mark-read"
  | "mark-unread"
  | "star"
  | "unstar"
  | "trash"
  | "archive"
  | "inbox"
  | "delete";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messageIds, action } = body as {
      messageIds?: string[];
      action?: BatchAction;
    };

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json(
        { error: "messageIds must be a non-empty array of strings" },
        { status: 400 }
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
        "delete",
      ].includes(action)
    ) {
      return NextResponse.json(
        { error: `Invalid action '${action}'` },
        { status: 400 }
      );
    }

    // Fetch existing messages to know their folders and accounts
    const messages = await prisma.message.findMany({
      where: { id: { in: messageIds } },
      select: {
        id: true,
        accountId: true,
        folderId: true,
        isRead: true,
        isStarred: true,
        folder: {
          select: {
            id: true,
            name: true,
            specialUse: true,
          },
        },
      },
    });

    if (messages.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

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

          await prisma.message.updateMany({
            where: { id: { in: ids } },
            data: { folderId: trashFolder.id },
          });

          ids.forEach((id) => {
            eventBus.broadcast("message-updated", {
              id,
              folderId: trashFolder!.id,
            });
          });
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

          await prisma.message.updateMany({
            where: { id: { in: ids } },
            data: { folderId: archiveFolder.id },
          });

          ids.forEach((id) => {
            eventBus.broadcast("message-updated", {
              id,
              folderId: archiveFolder!.id,
            });
          });
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

            await prisma.message.updateMany({
              where: { id: { in: ids } },
              data: { folderId: inboxFolder.id },
            });

            ids.forEach((id) => {
              eventBus.broadcast("message-updated", {
                id,
                folderId: inboxFolder.id,
              });
            });
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
      })
    );

    return NextResponse.json({ success: true, count: messageIds.length });
  } catch (error: any) {
    console.error("Batch message action error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
