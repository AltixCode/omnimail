import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import eventBus from "@/server/event-bus";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            id: true,
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

    if (!message) {
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

    const cleanSubject = (message.subject || "").replace(/^(re|fwd|fw):\s*/gi, "").trim();
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
          OR: threadConditions,
        },
        include: {
          account: {
            select: {
              id: true,
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
        threadMessages = Array.from(map.values()).sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
      }
    }

    return NextResponse.json({ message, thread: threadMessages });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const dataToUpdate: any = {};
    if (body.isRead !== undefined) dataToUpdate.isRead = Boolean(body.isRead);
    if (body.isStarred !== undefined) dataToUpdate.isStarred = Boolean(body.isStarred);
    if (body.folderId) dataToUpdate.folderId = body.folderId;

    const updated = await prisma.message.update({
      where: { id },
      data: dataToUpdate,
      include: {
        folder: true,
      },
    });

    // Update folder unread & total counts
    const [unreadCount, totalCount] = await Promise.all([
      prisma.message.count({ where: { folderId: updated.folderId, isRead: false } }),
      prisma.message.count({ where: { folderId: updated.folderId } }),
    ]);

    await prisma.folder.update({
      where: { id: updated.folderId },
      data: { unreadCount, totalCount },
    });

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

    return NextResponse.json({ success: true, message: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const message = await prisma.message.findUnique({
      where: { id },
      include: { folder: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Check if message is already in Trash
    const isTrash =
      message.folder.specialUse === "\\Trash" ||
      message.folder.name.toLowerCase().includes("trash") ||
      message.folder.name.toLowerCase().includes("bin");

    if (isTrash) {
      // Hard delete
      await prisma.message.delete({ where: { id } });
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
    }

    eventBus.broadcast("message-deleted", { id, folderId: message.folderId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
