import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import { parseSearchQuery } from "@/lib/search-query";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") || undefined;
    const folderId = searchParams.get("folderId") || undefined;
    const view = searchParams.get("view") || "inbox"; // inbox, starred, sent, archive, trash, all
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const starredOnly = searchParams.get("starredOnly") === "true";
    const hasAttachments = searchParams.get("hasAttachments") === "true";
    const query = searchParams.get("query")?.trim() || undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const skip = (page - 1) * limit;

    const where: Prisma.MessageWhereInput = {};
    const andConditions: Prisma.MessageWhereInput[] = [];

    // Parse query string if present (supports Gmail operators: from:, to:, subject:, larger:, etc.)
    const parsed = query ? parseSearchQuery(query) : null;
    const effectiveView = parsed?.inView || view;

    if (accountId) {
      where.accountId = accountId;
    }

    if (folderId) {
      where.folderId = folderId;
    } else if (effectiveView === "starred") {
      where.isStarred = true;
    } else if (effectiveView === "sent") {
      where.folder = {
        OR: [
          { specialUse: "\\Sent" },
          { name: { contains: "Sent", mode: "insensitive" } },
          { path: { contains: "Sent", mode: "insensitive" } },
        ],
      };
    } else if (effectiveView === "trash") {
      where.folder = {
        OR: [
          { specialUse: "\\Trash" },
          { name: { contains: "Trash", mode: "insensitive" } },
          { path: { contains: "Trash", mode: "insensitive" } },
        ],
      };
    } else if (effectiveView === "archive") {
      where.folder = {
        OR: [
          { specialUse: "\\Archive" },
          { name: { contains: "Archive", mode: "insensitive" } },
          { path: { contains: "Archive", mode: "insensitive" } },
        ],
      };
    } else if (effectiveView === "inbox") {
      where.folder = {
        OR: [
          { specialUse: "\\Inbox" },
          { path: "INBOX" },
          { name: "INBOX" },
        ],
      };
    } else if (effectiveView === "all") {
      // In all view, search across all messages without folder restrictions
    }

    if (unreadOnly || parsed?.isRead === false) {
      where.isRead = false;
    } else if (parsed?.isRead === true) {
      where.isRead = true;
    }

    if (starredOnly || parsed?.isStarred === true) {
      where.isStarred = true;
    }

    if (hasAttachments || parsed?.hasAttachment) {
      where.hasAttachments = true;
    }

    if (parsed) {
      // from:
      if (parsed.from) {
        andConditions.push({
          OR: [
            { fromAddress: { contains: parsed.from, mode: "insensitive" } },
            { fromName: { contains: parsed.from, mode: "insensitive" } },
          ],
        });
      }

      // to:
      if (parsed.to) {
        andConditions.push({
          toAddresses: { contains: parsed.to, mode: "insensitive" },
        });
      }

      // subject:
      if (parsed.subject) {
        andConditions.push({
          subject: { contains: parsed.subject, mode: "insensitive" },
        });
      }

      // body: / content:
      if (parsed.body) {
        andConditions.push({
          OR: [
            { bodyText: { contains: parsed.body, mode: "insensitive" } },
            { snippet: { contains: parsed.body, mode: "insensitive" } },
            { bodyHtml: { contains: parsed.body, mode: "insensitive" } },
          ],
        });
      }

      // has:invite / has:calendar
      if (parsed.hasInvite) {
        andConditions.push({
          attachments: {
            some: {
              OR: [
                { contentType: { contains: "calendar", mode: "insensitive" } },
                { filename: { endsWith: ".ics", mode: "insensitive" } },
              ],
            },
          },
        });
      }

      // filename: or attachment size filters
      const attachmentFilter: Prisma.AttachmentWhereInput = {};
      let hasAttachmentFilter = false;

      if (parsed.filename) {
        attachmentFilter.filename = { contains: parsed.filename, mode: "insensitive" };
        hasAttachmentFilter = true;
      }

      if (parsed.minSize !== undefined || parsed.maxSize !== undefined) {
        const sizeFilter: Prisma.IntFilter = {};
        if (parsed.minSize !== undefined) sizeFilter.gte = parsed.minSize;
        if (parsed.maxSize !== undefined) sizeFilter.lte = parsed.maxSize;
        attachmentFilter.size = sizeFilter;
        hasAttachmentFilter = true;
      }

      if (hasAttachmentFilter) {
        andConditions.push({
          attachments: {
            some: attachmentFilter,
          },
        });
      }

      // Date range: after: / before:
      if (parsed.afterDate || parsed.beforeDate) {
        const dateFilter: Prisma.DateTimeFilter = {};
        if (parsed.afterDate) dateFilter.gte = parsed.afterDate;
        if (parsed.beforeDate) dateFilter.lte = parsed.beforeDate;
        andConditions.push({ date: dateFilter });
      }

      // Exclude words: -term
      for (const ex of parsed.excludeWords) {
        andConditions.push({
          NOT: [
            { subject: { contains: ex, mode: "insensitive" } },
            { snippet: { contains: ex, mode: "insensitive" } },
            { bodyText: { contains: ex, mode: "insensitive" } },
            { fromName: { contains: ex, mode: "insensitive" } },
            { fromAddress: { contains: ex, mode: "insensitive" } },
            { attachments: { some: { filename: { contains: ex, mode: "insensitive" } } } },
          ],
        });
      }

      // Free text words: must match anywhere (subject, body, snippet, sender, recipient, attachments)
      for (const word of parsed.freeWords) {
        andConditions.push({
          OR: [
            { subject: { contains: word, mode: "insensitive" } },
            { snippet: { contains: word, mode: "insensitive" } },
            { bodyText: { contains: word, mode: "insensitive" } },
            { fromAddress: { contains: word, mode: "insensitive" } },
            { fromName: { contains: word, mode: "insensitive" } },
            { toAddresses: { contains: word, mode: "insensitive" } },
            { ccAddresses: { contains: word, mode: "insensitive" } },
            {
              attachments: {
                some: {
                  filename: { contains: word, mode: "insensitive" },
                },
              },
            },
          ],
        });
      }
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [messages, totalCount] = await Promise.all([
      prisma.message.findMany({
        where,
        select: {
          id: true,
          accountId: true,
          folderId: true,
          uid: true,
          messageId: true,
          threadId: true,
          fromAddress: true,
          fromName: true,
          toAddresses: true,
          subject: true,
          date: true,
          snippet: true,
          isRead: true,
          isStarred: true,
          hasAttachments: true,
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
            where: {
              OR: [
                { contentType: { contains: "calendar", mode: "insensitive" } },
                { filename: { contains: ".ics", mode: "insensitive" } },
                { contentType: { contains: "application/ics", mode: "insensitive" } },
              ],
            },
            select: { id: true },
          },
        },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      prisma.message.count({ where }),
    ]);

    const mappedMessages = messages.map((m: any) => ({
      ...m,
      hasCalendarInvite: Boolean(m.attachments && m.attachments.length > 0),
      attachments: undefined,
    }));

    return NextResponse.json({
      messages: mappedMessages,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error: any) {
    console.error("Failed to fetch messages:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
