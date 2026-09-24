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

      const emailLower = acc.emailAddress.toLowerCase();
      const imapLower = (acc.imapHost || "").toLowerCase();

      const hasCalendarSupport =
        Boolean(acc.caldavUrl) ||
        emailLower.endsWith("@gmail.com") ||
        emailLower.endsWith("@googlemail.com") ||
        emailLower.endsWith("@purelymail.com") ||
        emailLower.endsWith("@icloud.com") ||
        emailLower.endsWith("@me.com") ||
        emailLower.endsWith("@mac.com") ||
        emailLower.endsWith("@fastmail.com") ||
        emailLower.endsWith("@fastmail.fm") ||
        emailLower.endsWith("@yahoo.com") ||
        emailLower.endsWith("@ymail.com") ||
        emailLower.endsWith("@aol.com") ||
        emailLower.endsWith("@zoho.com") ||
        emailLower.endsWith("@zoho.eu") ||
        emailLower.endsWith("@mailbox.org") ||
        emailLower.endsWith("@posteo.de") ||
        emailLower.endsWith("@posteo.net") ||
        emailLower.endsWith("@gmx.net") ||
        emailLower.endsWith("@gmx.de") ||
        emailLower.endsWith("@gmx.com") ||
        emailLower.endsWith("@web.de") ||
        imapLower.includes("google") ||
        imapLower.includes("purelymail") ||
        imapLower.includes("mail.me.com") ||
        imapLower.includes("fastmail") ||
        imapLower.includes("yahoo") ||
        imapLower.includes("zoho") ||
        imapLower.includes("mailbox.org") ||
        imapLower.includes("posteo") ||
        imapLower.includes("gmx") ||
        imapLower.includes("web.de");

      if (hasCalendarSupport) {
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
