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

    return NextResponse.json({ message });
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

      await prisma.message.update({
        where: { id },
        data: { folderId: trashFolder.id },
      });
    }

    eventBus.broadcast("message-deleted", { id, folderId: message.folderId });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
