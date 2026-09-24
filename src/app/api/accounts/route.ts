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
      syncActive = true,
      syncIntervalMinutes = 5,
      enableIdle = true,
      syncMaxMessages = 100,
      syncFolderScope = "all",
      caldavSyncIntervalMinutes = 15,
    } = body;

    if (!emailAddress || !imapHost || !imapUser || !imapPassword || !smtpHost || !smtpUser || !smtpPassword) {
      return NextResponse.json(
        { error: "Missing required IMAP or SMTP fields" },
        { status: 400 }
      );
    }

    const imapPassEnc = encryptSecret(imapPassword);
    const smtpPassEnc = encryptSecret(smtpPassword);

    let finalCaldavUrl = caldavUrl ? caldavUrl.trim() : null;
    const emailLower = emailAddress.toLowerCase();
    const imapHostLower = imapHost.toLowerCase();

    if (finalCaldavUrl && finalCaldavUrl.includes("mail.purelymail.com")) {
      finalCaldavUrl = "https://purelymail.com/dav/";
    } else if (!finalCaldavUrl) {
      if (emailLower.endsWith("@purelymail.com") || imapHostLower.includes("purelymail")) {
        finalCaldavUrl = "https://purelymail.com/dav/";
      } else if (emailLower.endsWith("@icloud.com") || emailLower.endsWith("@me.com") || emailLower.endsWith("@mac.com") || imapHostLower.includes("mail.me.com")) {
        finalCaldavUrl = "https://caldav.icloud.com/";
      } else if (emailLower.endsWith("@fastmail.com") || emailLower.endsWith("@fastmail.fm") || imapHostLower.includes("fastmail")) {
        finalCaldavUrl = "https://caldav.fastmail.com/dav/";
      } else if (emailLower.endsWith("@yahoo.com") || emailLower.endsWith("@aol.com") || imapHostLower.includes("yahoo") || imapHostLower.includes("aol")) {
        finalCaldavUrl = "https://caldav.calendar.yahoo.com/";
      } else if (emailLower.endsWith("@zoho.com") || emailLower.endsWith("@zoho.eu") || imapHostLower.includes("zoho")) {
        finalCaldavUrl = emailLower.endsWith(".eu") ? "https://calendar.zoho.eu/" : "https://calendar.zoho.com/";
      } else if (emailLower.endsWith("@mailbox.org") || imapHostLower.includes("mailbox.org")) {
        finalCaldavUrl = "https://dav.mailbox.org/caldav/";
      } else if (emailLower.endsWith("@posteo.de") || emailLower.endsWith("@posteo.net") || imapHostLower.includes("posteo")) {
        finalCaldavUrl = "https://posteo.de:8443/";
      } else if (emailLower.endsWith("@gmx.net") || emailLower.endsWith("@gmx.de") || emailLower.endsWith("@gmx.com") || imapHostLower.includes("gmx")) {
        finalCaldavUrl = `https://caldav.gmx.net/begenda/dav/users/${encodeURIComponent(imapUser || emailAddress)}/`;
      } else if (emailLower.endsWith("@web.de") || imapHostLower.includes("web.de")) {
        finalCaldavUrl = `https://caldav.web.de/begenda/dav/users/${encodeURIComponent(imapUser || emailAddress)}/`;
      }
    }

    const finalCaldavUser = caldavUser || (finalCaldavUrl ? (imapUser || emailAddress) : null);
    const finalCaldavPassEnc = caldavPassword
      ? encryptSecret(caldavPassword)
      : (finalCaldavUrl ? imapPassEnc : null);

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
        caldavUrl: finalCaldavUrl,
        caldavUser: finalCaldavUser,
        caldavPassEnc: finalCaldavPassEnc,
        syncActive: Boolean(syncActive),
        syncIntervalMinutes: Number(syncIntervalMinutes) || 5,
        enableIdle: Boolean(enableIdle),
        syncMaxMessages: Number(syncMaxMessages) || 100,
        syncFolderScope: String(syncFolderScope) || "all",
        caldavSyncIntervalMinutes: Number(caldavSyncIntervalMinutes) || 15,
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
