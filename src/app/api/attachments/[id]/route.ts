import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: {
        message: {
          include: {
            account: true,
            folder: true,
          },
        },
      },
    });

    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    let base64Data = attachment.dataBase64;

    // If attachment data is not cached in DB, fetch on-demand from the mail server!
    if (!base64Data && attachment.message && attachment.message.account) {
      const msg = attachment.message;
      const account = msg.account;
      const folderPath = msg.folder?.path || "INBOX";

      try {
        let password = decryptSecret(account.imapPassEnc);
        if (account.imapHost.includes("gmail.com") && password) {
          const clean = password.replace(/\s+/g, "");
          if (clean.length === 16) password = clean;
        }

        const client = new ImapFlow({
          host: account.imapHost,
          port: account.imapPort,
          secure: account.imapSecure,
          auth: {
            user: account.imapUser,
            pass: password,
          },
          logger: false,
        });

        client.on("error", () => {});

        await client.connect();
        const lock = await client.getMailboxLock(folderPath);
        try {
          const download = await client.download(String(msg.uid), undefined, { uid: true });
          if (download && download.content) {
            const parsed = await simpleParser(download.content);
            const foundAtt = parsed.attachments.find(
              (att) => att.filename === attachment.filename || att.cid === attachment.contentId
            );
            if (foundAtt && foundAtt.content) {
              base64Data = foundAtt.content.toString("base64");
              // Cache in database so subsequent downloads are instant
              await prisma.attachment.update({
                where: { id },
                data: { dataBase64: base64Data },
              }).catch(() => {});
            }
          }
        } finally {
          lock.release();
          await client.logout();
        }
      } catch (imapErr) {
        console.error(`Failed to on-demand fetch attachment ${id} from IMAP:`, imapErr);
      }
    }

    if (!base64Data) {
      return NextResponse.json(
        { error: "Attachment content is unavailable on the server" },
        { status: 404 }
      );
    }

    const buffer = Buffer.from(base64Data, "base64");
    const safeFilename = (attachment.filename || "attachment").replace(/["\r\n\t]/g, "_");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": attachment.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(attachment.filename || "attachment")}`,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error: any) {
    console.error("Error downloading attachment:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
