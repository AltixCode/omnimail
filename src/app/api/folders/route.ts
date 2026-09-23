import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser();
    const accounts = await prisma.mailAccount.findMany({
      where: { userId: user.id },
      include: {
        folders: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Compute unified counts
    const inboxFolders = accounts.flatMap((a) =>
      a.folders.filter((f) => f.specialUse === "\\Inbox" || f.path.toUpperCase() === "INBOX")
    );
    const totalInboxUnread = inboxFolders.reduce((acc, f) => acc + f.unreadCount, 0);

    const starredCount = await prisma.message.count({
      where: {
        account: { userId: user.id },
        isStarred: true,
      },
    });

    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        emailAddress: a.emailAddress,
        syncStatus: a.syncStatus,
        lastSyncAt: a.lastSyncAt,
        folders: a.folders,
      })),
      unifiedCounts: {
        inboxUnread: totalInboxUnread,
        starred: starredCount,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
