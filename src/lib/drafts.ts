import prisma from "./db";
import eventBus from "@/server/event-bus";
import { cleanRedundantListMarkers } from "./paste-handler";

export interface SaveDraftParams {
  draftId?: string | null;
  accountId: string;
  to?: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: string; // base64
  }>;
}

export async function saveDraft(userId: string, params: SaveDraftParams) {
  const account = await prisma.mailAccount.findUnique({
    where: { id: params.accountId },
  });

  if (!account || account.userId !== userId) {
    throw new Error("Account not found or access denied");
  }

  // Find or create Drafts folder
  let draftsFolder = await prisma.folder.findFirst({
    where: {
      accountId: account.id,
      OR: [
        { specialUse: "\\Drafts" },
        { name: { contains: "Draft", mode: "insensitive" } },
        { path: { contains: "Draft", mode: "insensitive" } },
      ],
    },
  });

  if (!draftsFolder) {
    draftsFolder = await prisma.folder.create({
      data: {
        accountId: account.id,
        name: "Drafts",
        path: "Drafts",
        specialUse: "\\Drafts",
      },
    });
  }

  // Parse recipient arrays
  const toArray = Array.isArray(params.to)
    ? params.to
    : params.to
    ? params.to.split(/[,;]/).map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean)
    : [];

  const ccArray = Array.isArray(params.cc)
    ? params.cc
    : params.cc
    ? params.cc.split(/[,;]/).map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean)
    : [];

  const bccArray = Array.isArray(params.bcc)
    ? params.bcc
    : params.bcc
    ? params.bcc.split(/[,;]/).map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean)
    : [];

  const snippet = (params.bodyText || params.subject || "").slice(0, 250);
  const hasAttachments = Boolean(params.attachments && params.attachments.length > 0);
  const now = new Date();
  const cleanedHtml = params.bodyHtml ? cleanRedundantListMarkers(params.bodyHtml) : "";

  // If draftId is provided, check if it exists and belongs to this user
  if (params.draftId) {
    const existing = await prisma.message.findUnique({
      where: { id: params.draftId },
      include: { account: { select: { userId: true } } },
    });

    if (existing && existing.account.userId === userId) {
      // Update existing draft
      // Delete old attachments if new ones are provided
      if (params.attachments) {
        await prisma.attachment.deleteMany({
          where: { messageId: existing.id },
        });
      }

      const updated = await prisma.message.update({
        where: { id: existing.id },
        data: {
          toAddresses: JSON.stringify(toArray),
          ccAddresses: ccArray.length > 0 ? JSON.stringify(ccArray) : null,
          bccAddresses: bccArray.length > 0 ? JSON.stringify(bccArray) : null,
          subject: params.subject || "",
          bodyText: params.bodyText || "",
          bodyHtml: cleanedHtml,
          snippet,
          date: now,
          hasAttachments,
          replyTo: params.inReplyTo || undefined,
          threadId: params.threadId || params.inReplyTo || undefined,
          attachments:
            hasAttachments && params.attachments
              ? {
                  create: params.attachments.map((att) => ({
                    filename: att.filename,
                    contentType: att.contentType,
                    size: att.size || Math.round((att.content.length * 3) / 4),
                    dataBase64: att.content,
                  })),
                }
              : undefined,
        },
        include: {
          folder: true,
          account: {
            select: {
              id: true,
              label: true,
              emailAddress: true,
            },
          },
        },
      });

      eventBus.broadcast("message-updated", {
        id: updated.id,
        folderId: updated.folderId,
        accountId: updated.accountId,
        subject: updated.subject,
        date: updated.date.toISOString(),
      });

      return updated;
    }
  }

  // Create new draft
  const lastMsg = await prisma.message.findFirst({
    where: { folderId: draftsFolder.id },
    orderBy: { uid: "desc" },
    select: { uid: true },
  });
  const nextUid = (lastMsg?.uid || 0) + 1;

  const newDraft = await prisma.message.create({
    data: {
      accountId: account.id,
      folderId: draftsFolder.id,
      uid: nextUid,
      fromAddress: account.emailAddress,
      fromName: account.label || null,
      toAddresses: JSON.stringify(toArray),
      ccAddresses: ccArray.length > 0 ? JSON.stringify(ccArray) : null,
      bccAddresses: bccArray.length > 0 ? JSON.stringify(bccArray) : null,
      subject: params.subject || "",
      bodyText: params.bodyText || "",
      bodyHtml: cleanedHtml,
      snippet,
      date: now,
      flags: JSON.stringify(["\\Draft"]),
      isRead: true,
      isStarred: false,
      hasAttachments,
      replyTo: params.inReplyTo || undefined,
      threadId: params.threadId || params.inReplyTo || undefined,
      attachments:
        hasAttachments && params.attachments
          ? {
              create: params.attachments.map((att) => ({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size || Math.round((att.content.length * 3) / 4),
                dataBase64: att.content,
              })),
            }
          : undefined,
    },
    include: {
      folder: true,
      account: {
        select: {
          id: true,
          label: true,
          emailAddress: true,
        },
      },
    },
  });

  // Update folder total count
  await prisma.folder.update({
    where: { id: draftsFolder.id },
    data: {
      totalCount: { increment: 1 },
    },
  });

  eventBus.broadcast("new-message", {
    id: newDraft.id,
    folderId: newDraft.folderId,
    accountId: newDraft.accountId,
    subject: newDraft.subject,
    date: newDraft.date.toISOString(),
  });

  return newDraft;
}

export async function deleteDraft(userId: string, draftId: string) {
  if (!draftId) return { success: false, error: "Draft ID required" };

  const message = await prisma.message.findUnique({
    where: { id: draftId },
    include: {
      folder: true,
      account: { select: { userId: true } },
    },
  });

  if (!message || message.account.userId !== userId) {
    return { success: false, error: "Draft not found or access denied" };
  }

  // Delete message and its attachments
  await prisma.attachment.deleteMany({
    where: { messageId: draftId },
  });

  await prisma.message.delete({
    where: { id: draftId },
  });

  // Decrement folder count if greater than 0
  if (message.folder.totalCount > 0) {
    await prisma.folder.update({
      where: { id: message.folderId },
      data: {
        totalCount: { decrement: 1 },
      },
    });
  }

  eventBus.broadcast("message-deleted", {
    id: draftId,
    folderId: message.folderId,
    accountId: message.accountId,
  });

  return { success: true };
}
