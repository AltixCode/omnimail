import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import {
  executeAiAssist,
  ThreadMessageContext,
} from "@/lib/ai-assistant";
import { extractPlainTextFromHtml } from "@/lib/translator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);

    const body = await req.json();
    const {
      action = "draft",
      text,
      instruction,
      tone = "professional",
      messageId,
      threadId,
      subject,
      recipient,
      threadMessages: clientThreadMessages,
    } = body || {};

    let resolvedThreadMessages: ThreadMessageContext[] = [];

    // 1. If client sent thread messages directly, use them
    if (Array.isArray(clientThreadMessages) && clientThreadMessages.length > 0) {
      resolvedThreadMessages = clientThreadMessages;
    } else if (messageId) {
      // 2. Otherwise, if messageId is provided, query the database for the thread context
      const targetMessage = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          account: {
            select: {
              userId: true,
              emailAddress: true,
            },
          },
        },
      });

      if (targetMessage && targetMessage.account.userId === user.id) {
        // Resolve thread messages matching threadId, messageId, or subject
        const threadConditions: any[] = [];
        if (targetMessage.threadId) {
          threadConditions.push({ threadId: targetMessage.threadId });
          threadConditions.push({ messageId: targetMessage.threadId });
        }
        if (targetMessage.messageId) {
          threadConditions.push({ threadId: targetMessage.messageId });
        }

        const cleanSubject = (targetMessage.subject || "")
          .replace(/^(re|fwd|fw):\s*/gi, "")
          .trim();
        if (threadConditions.length === 0 && cleanSubject.length > 2) {
          threadConditions.push({
            accountId: targetMessage.accountId,
            subject: {
              contains: cleanSubject,
              mode: "insensitive",
            },
          });
        }

        let messagesInThread: Array<{
          id: string;
          fromName?: string | null;
          fromAddress: string;
          toAddresses?: string | null;
          date: string | Date;
          subject?: string | null;
          bodyText?: string | null;
          bodyHtml?: string | null;
        }> = [targetMessage];
        if (threadConditions.length > 0) {
          const found = await prisma.message.findMany({
            where: {
              accountId: targetMessage.accountId,
              OR: threadConditions,
            },
            orderBy: {
              date: "asc",
            },
            take: 20,
          });
          if (found.length > 0) {
            messagesInThread = found;
          }
        }

        resolvedThreadMessages = messagesInThread.map((m) => ({
          id: m.id,
          from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
          to: m.toAddresses,
          date: m.date,
          subject: m.subject,
          body: m.bodyText || extractPlainTextFromHtml(m.bodyHtml || ""),
        }));
      }
    }

    const aiConfig = {
      aiProxyUrl: (user as any).aiProxyUrl,
      aiProxyToken: (user as any).aiProxyToken,
      aiModel: (user as any).aiModel,
    };

    const result = await executeAiAssist({
      action: action === "rephrase" ? "rephrase" : "draft",
      text,
      instruction,
      tone,
      threadMessages: resolvedThreadMessages,
      subject,
      recipient,
      sender: user.name ? `${user.name} <${user.email}>` : user.email,
      ...aiConfig,
    });

    return NextResponse.json({
      success: true,
      text: result.text,
      action: result.action,
      model: result.model,
    });
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("AI Assist API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate AI assist response" },
      { status: 500 },
    );
  }
}
