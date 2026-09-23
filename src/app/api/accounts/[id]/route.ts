import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import imapWorkerPool from "@/server/imap-worker";

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
    if (body.syncActive !== undefined) dataToUpdate.syncActive = body.syncActive;
    if (body.imapPassword) dataToUpdate.imapPassEnc = encryptSecret(body.imapPassword);
    if (body.smtpPassword) dataToUpdate.smtpPassEnc = encryptSecret(body.smtpPassword);
    if (body.caldavPassword) dataToUpdate.caldavPassEnc = encryptSecret(body.caldavPassword);
    if (body.caldavUrl !== undefined) dataToUpdate.caldavUrl = body.caldavUrl;
    if (body.caldavUser !== undefined) dataToUpdate.caldavUser = body.caldavUser;

    const updated = await prisma.mailAccount.update({
      where: { id },
      data: dataToUpdate,
    });

    if (body.syncActive === false) {
      await imapWorkerPool.stopAccount(id);
    } else if (body.syncActive === true) {
      await imapWorkerPool.startIdle(id);
    }

    return NextResponse.json({ success: true, account: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
