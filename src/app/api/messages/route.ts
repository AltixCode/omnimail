import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";

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

    if (accountId) {
      where.accountId = accountId;
    }

    if (folderId) {
      where.folderId = folderId;
    } else if (view === "starred") {
      where.isStarred = true;
    } else if (view === "sent") {
      where.folder = {
        OR: [
          { specialUse: "\\Sent" },
          { name: { contains: "Sent", mode: "insensitive" } },
          { path: { contains: "Sent", mode: "insensitive" } },
        ],
      };
    } else if (view === "trash") {
      where.folder = {
        OR: [
          { specialUse: "\\Trash" },
          { name: { contains: "Trash", mode: "insensitive" } },
          { path: { contains: "Trash", mode: "insensitive" } },
        ],
      };
    } else if (view === "archive") {
      where.folder = {
        OR: [
          { specialUse: "\\Archive" },
          { name: { contains: "Archive", mode: "insensitive" } },
          { path: { contains: "Archive", mode: "insensitive" } },
        ],
      };
    } else if (view === "inbox") {
      where.folder = {
        OR: [
          { specialUse: "\\Inbox" },
          { path: "INBOX" },
          { name: "INBOX" },
        ],
      };
    }

    if (unreadOnly) {
      where.isRead = false;
    }

    if (starredOnly) {
      where.isStarred = true;
    }

    if (hasAttachments) {
      where.hasAttachments = true;
    }

    if (query) {
      where.OR = [
        { subject: { contains: query, mode: "insensitive" } },
        { fromAddress: { contains: query, mode: "insensitive" } },
        { fromName: { contains: query, mode: "insensitive" } },
        { snippet: { contains: query, mode: "insensitive" } },
        { bodyText: { contains: query, mode: "insensitive" } },
      ];
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
        },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      prisma.message.count({ where }),
    ]);

    return NextResponse.json({
      messages,
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
