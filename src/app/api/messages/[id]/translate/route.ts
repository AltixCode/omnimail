import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import scheduledEmailWorker from "@/server/scheduled-worker";
import { translateEmail } from "@/lib/translator";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional
    }

    const targetLanguage = body?.targetLanguage || "English";

    // Handle scheduled emails
    if (id.startsWith("sched_")) {
      const scheduledMessage = await scheduledEmailWorker.getScheduledEmailDetail(
        id,
        user.id,
      );
      if (!scheduledMessage) {
        return NextResponse.json({ error: "Scheduled email not found" }, { status: 404 });
      }

      const translation = await translateEmail({
        subject: scheduledMessage.subject,
        bodyHtml: scheduledMessage.bodyHtml,
        bodyText: scheduledMessage.bodyText,
        targetLanguage,
      });

      return NextResponse.json({
        success: true,
        messageId: id,
        original: {
          subject: scheduledMessage.subject,
          bodyHtml: scheduledMessage.bodyHtml,
          bodyText: scheduledMessage.bodyText,
        },
        translated: translation,
      });
    }

    // Normal stored email
    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!message || message.account.userId !== user.id) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const translation = await translateEmail({
      subject: message.subject,
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
      targetLanguage,
    });

    return NextResponse.json({
      success: true,
      messageId: id,
      original: {
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        bodyText: message.bodyText,
      },
      translated: translation,
    });
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Translation API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to translate email" },
      { status: 500 },
    );
  }
}
