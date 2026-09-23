import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import imapWorkerPool from "@/server/imap-worker";
import caldavWorker from "@/server/caldav-worker";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser();
    const body = await req.json().catch(() => ({}));
    const { accountId } = body;

    const accounts = await prisma.mailAccount.findMany({
      where: {
        userId: user.id,
        syncActive: true,
        ...(accountId ? { id: accountId } : {}),
      },
    });

    const results = [];

    for (const acc of accounts) {
      const mailSync = await imapWorkerPool.syncAccount(acc.id);
      let calSync = null;

      if (acc.caldavUrl) {
        calSync = await caldavWorker.syncAccount(acc.id);
      }

      // Ensure IDLE is running
      imapWorkerPool.startIdle(acc.id).catch(() => {});

      results.push({
        accountId: acc.id,
        label: acc.label,
        mail: mailSync,
        calendar: calSync,
      });
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Error triggering manual sync:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
