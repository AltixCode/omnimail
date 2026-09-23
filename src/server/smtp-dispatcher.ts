import nodemailer, { type SendMailOptions } from "nodemailer";
import prisma from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import eventBus from "./event-bus";

export interface SendMailParams {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType: string;
  }>;
}

export async function sendEmail(params: SendMailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const account = await prisma.mailAccount.findUnique({
      where: { id: params.accountId },
    });

    if (!account) {
      return { success: false, error: "Account not found" };
    }

    let password = decryptSecret(account.smtpPassEnc);
    if (account.smtpHost.includes("gmail.com") && password) {
      const clean = password.replace(/\s+/g, "");
      if (clean.length === 16) {
        password = clean;
      }
    }

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: {
        user: account.smtpUser,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false, // allow self-signed / enterprise certs
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });

    const fromHeader = account.label
      ? `"${account.label}" <${account.emailAddress}>`
      : account.emailAddress;

    const mailOptions: SendMailOptions = {
      from: fromHeader,
      to: params.to.join(", "),
      cc: params.cc && params.cc.length > 0 ? params.cc.join(", ") : undefined,
      bcc: params.bcc && params.bcc.length > 0 ? params.bcc.join(", ") : undefined,
      subject: params.subject,
      text: params.bodyText,
      html: params.bodyHtml || (params.bodyText ? `<p>${params.bodyText.replace(/\n/g, "<br>")}</p>` : undefined),
      inReplyTo: params.inReplyTo,
      references: params.references,
      attachments: params.attachments?.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content, "base64"),
        contentType: att.contentType,
      })),
    };

    const info = await transporter.sendMail(mailOptions);

    // Save copy to local Sent folder
    try {
      let sentFolder = await prisma.folder.findFirst({
        where: {
          accountId: account.id,
          OR: [{ specialUse: "\\Sent" }, { name: { contains: "Sent", mode: "insensitive" } }],
        },
      });

      if (!sentFolder) {
        sentFolder = await prisma.folder.create({
          data: {
            accountId: account.id,
            name: "Sent",
            path: "Sent",
            specialUse: "\\Sent",
          },
        });
      }

      // Generate a synthetic UID for sent email
      const lastMsg = await prisma.message.findFirst({
        where: { folderId: sentFolder.id },
        orderBy: { uid: "desc" },
        select: { uid: true },
      });
      const nextUid = (lastMsg?.uid || 0) + 1;

      const hasAttachments = Boolean(params.attachments && params.attachments.length > 0);
      const snippet = (params.bodyText || params.subject || "").slice(0, 250);

      const savedSent = await prisma.message.create({
        data: {
          accountId: account.id,
          folderId: sentFolder.id,
          uid: nextUid,
          messageId: info.messageId,
          threadId: params.threadId || params.inReplyTo || info.messageId,
          fromAddress: account.emailAddress,
          fromName: account.label || null,
          toAddresses: JSON.stringify(params.to),
          ccAddresses: params.cc ? JSON.stringify(params.cc) : null,
          bccAddresses: params.bcc ? JSON.stringify(params.bcc) : null,
          subject: params.subject,
          date: new Date(),
          snippet,
          bodyText: params.bodyText || "",
          bodyHtml: params.bodyHtml || "",
          isRead: true,
          isStarred: false,
          hasAttachments,
          attachments: hasAttachments
            ? {
                create: params.attachments!.map((att) => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: Math.round((att.content.length * 3) / 4),
                  dataBase64: att.content, // Save full base64 so sent attachments can always be downloaded!
                })),
              }
            : undefined,
        },
        include: {
          account: {
            select: {
              label: true,
              emailAddress: true,
            },
          },
          folder: {
            select: {
              name: true,
              specialUse: true,
            },
          },
          attachments: {
            select: {
              id: true,
              filename: true,
              contentType: true,
              size: true,
            },
          },
        },
      });

      // Update sent folder counts
      const totalCount = await prisma.message.count({ where: { folderId: sentFolder.id } });
      await prisma.folder.update({
        where: { id: sentFolder.id },
        data: { totalCount },
      });

      eventBus.broadcast("new-message", {
        accountId: account.id,
        folderId: sentFolder.id,
        isSent: true,
        message: {
          id: savedSent.id,
          accountId: account.id,
          folderId: sentFolder.id,
          uid: savedSent.uid,
          messageId: savedSent.messageId,
          threadId: savedSent.threadId,
          fromAddress: savedSent.fromAddress,
          fromName: savedSent.fromName,
          toAddresses: savedSent.toAddresses,
          subject: savedSent.subject,
          date: savedSent.date.toISOString(),
          snippet: savedSent.snippet,
          isRead: true,
          isStarred: false,
          hasAttachments: savedSent.hasAttachments,
          account: {
            label: account.label,
            emailAddress: account.emailAddress,
          },
          folder: {
            name: sentFolder.name,
            specialUse: sentFolder.specialUse,
          },
          attachments: savedSent.attachments,
        },
      });
    } catch (saveErr) {
      console.error("Failed to save sent message to local Sent folder:", saveErr);
    }

    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    console.error("Error sending email:", err);
    return { success: false, error: err?.message || String(err) };
  }
}
