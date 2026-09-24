import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import imapWorkerPool from "@/server/imap-worker";

import caldavWorker from "@/server/caldav-worker";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Stop IDLE worker
    await imapWorkerPool.stopAccount(id);

    await prisma.mailAccount.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
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
    if (body.label !== undefined) dataToUpdate.label = body.label;
    if (body.emailAddress !== undefined) dataToUpdate.emailAddress = body.emailAddress;
    
    // IMAP Settings
    if (body.imapHost !== undefined) dataToUpdate.imapHost = body.imapHost;
    if (body.imapPort !== undefined) dataToUpdate.imapPort = Number(body.imapPort);
    if (body.imapSecure !== undefined) dataToUpdate.imapSecure = Boolean(body.imapSecure);
    if (body.imapUser !== undefined) dataToUpdate.imapUser = body.imapUser;
    if (body.imapPassword) dataToUpdate.imapPassEnc = encryptSecret(body.imapPassword);

    // SMTP Settings
    if (body.smtpHost !== undefined) dataToUpdate.smtpHost = body.smtpHost;
    if (body.smtpPort !== undefined) dataToUpdate.smtpPort = Number(body.smtpPort);
    if (body.smtpSecure !== undefined) dataToUpdate.smtpSecure = Boolean(body.smtpSecure);
    if (body.smtpUser !== undefined) dataToUpdate.smtpUser = body.smtpUser;
    if (body.smtpPassword) dataToUpdate.smtpPassEnc = encryptSecret(body.smtpPassword);

    // CalDAV Settings
    if (body.caldavUrl !== undefined) dataToUpdate.caldavUrl = body.caldavUrl || null;
    if (body.caldavUser !== undefined) dataToUpdate.caldavUser = body.caldavUser || null;
    if (body.caldavPassword) dataToUpdate.caldavPassEnc = encryptSecret(body.caldavPassword);
    
    // Sync & Engine Parameters
    if (body.syncActive !== undefined) dataToUpdate.syncActive = Boolean(body.syncActive);
    if (body.syncIntervalMinutes !== undefined) dataToUpdate.syncIntervalMinutes = Number(body.syncIntervalMinutes);
    if (body.enableIdle !== undefined) dataToUpdate.enableIdle = Boolean(body.enableIdle);
    if (body.syncMaxMessages !== undefined) dataToUpdate.syncMaxMessages = Number(body.syncMaxMessages);
    if (body.syncFolderScope !== undefined) dataToUpdate.syncFolderScope = String(body.syncFolderScope);
    if (body.caldavSyncIntervalMinutes !== undefined) dataToUpdate.caldavSyncIntervalMinutes = Number(body.caldavSyncIntervalMinutes);

    // Reset syncStatus to idle so UI immediately updates from error state
    dataToUpdate.syncStatus = "idle";
    dataToUpdate.lastError = null;

    const updated = await prisma.mailAccount.update({
      where: { id },
      data: dataToUpdate,
    });

    // Restart worker if account is active
    await imapWorkerPool.stopAccount(id);

    if (updated.syncActive) {
      setTimeout(async () => {
        try {
          await imapWorkerPool.syncAccount(id);
          await imapWorkerPool.startIdle(id);
          if (updated.caldavUrl) {
            await caldavWorker.syncAccount(id);
          }
        } catch (syncErr) {
          console.error("Worker sync failed after account update:", syncErr);
        }
      }, 100);
    }

    return NextResponse.json({ success: true, account: updated });
  } catch (error: any) {
    console.error("Failed to update account:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
