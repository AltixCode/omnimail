import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getOrCreateDefaultUser } from "@/lib/user";
import imapWorkerPool from "@/server/imap-worker";
import caldavWorker from "@/server/caldav-worker";

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
        calendars: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Strip encrypted passwords before returning to client
    const safeAccounts = accounts.map((acc) => {
      const { imapPassEnc, smtpPassEnc, caldavPassEnc, ...safe } = acc;
      return {
        ...safe,
        hasCaldav: Boolean(acc.caldavUrl),
      };
    });

    return NextResponse.json({ accounts: safeAccounts });
  } catch (error: any) {
    console.error("Failed to fetch accounts:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser();
    const body = await req.json();

    const {
      label,
      emailAddress,
      imapHost,
      imapPort = 993,
      imapSecure = true,
      imapUser,
      imapPassword,
      smtpHost,
      smtpPort = 587,
      smtpSecure = false,
      smtpUser,
      smtpPassword,
      caldavUrl,
      caldavUser,
      caldavPassword,
    } = body;

    if (!emailAddress || !imapHost || !imapUser || !imapPassword || !smtpHost || !smtpUser || !smtpPassword) {
      return NextResponse.json(
        { error: "Missing required IMAP or SMTP fields" },
        { status: 400 }
      );
    }

    const imapPassEnc = encryptSecret(imapPassword);
    const smtpPassEnc = encryptSecret(smtpPassword);
    const caldavPassEnc = caldavPassword ? encryptSecret(caldavPassword) : null;

    const account = await prisma.mailAccount.create({
      data: {
        userId: user.id,
        label: label || emailAddress,
        emailAddress,
        imapHost,
        imapPort: Number(imapPort),
        imapSecure: Boolean(imapSecure),
        imapUser,
        imapPassEnc,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecure: Boolean(smtpSecure),
        smtpUser,
        smtpPassEnc,
        caldavUrl: caldavUrl || null,
        caldavUser: caldavUser || null,
        caldavPassEnc,
        syncActive: true,
      },
    });

    // Kick off background initial sync & IDLE loop
    setTimeout(async () => {
      try {
        await imapWorkerPool.syncAccount(account.id);
        await imapWorkerPool.startIdle(account.id);
        if (account.caldavUrl) {
          await caldavWorker.syncAccount(account.id);
        }
      } catch (syncErr) {
        console.error("Initial account sync failed:", syncErr);
      }
    }, 100);

    return NextResponse.json({
      success: true,
      account: {
        id: account.id,
        label: account.label,
        emailAddress: account.emailAddress,
      },
    });
  } catch (error: any) {
    console.error("Failed to create account:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
