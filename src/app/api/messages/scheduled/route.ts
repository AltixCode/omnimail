import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import scheduledEmailWorker from "@/server/scheduled-worker";
import { resolveEffectiveTimezone } from "@/lib/timezone";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("accountId") || undefined;

    const messages = await scheduledEmailWorker.getScheduledMessagesForUser(
      user.id,
      accountId
    );

    return NextResponse.json({
      messages,
      total: messages.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();
    const {
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      threadId,
      attachments,
      scheduledAt,
      timezone,
    } = body;

    if (!accountId || !to || !subject || !scheduledAt) {
      return NextResponse.json(
        { error: "Missing required fields: accountId, to, subject, scheduledAt" },
        { status: 400 }
      );
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid scheduledAt timestamp." },
        { status: 400 }
      );
    }

    if (scheduledDate.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Scheduled send time must be in the future." },
        { status: 400 }
      );
    }

    const ownedAccount = await prisma.mailAccount.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!ownedAccount || ownedAccount.userId !== user.id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const toArray = Array.isArray(to)
      ? to
      : to.split(",").map((s: string) => s.trim()).filter(Boolean);
    const ccArray = cc
      ? Array.isArray(cc)
        ? cc
        : cc.split(",").map((s: string) => s.trim()).filter(Boolean)
      : undefined;
    const bccArray = bcc
      ? Array.isArray(bcc)
        ? bcc
        : bcc.split(",").map((s: string) => s.trim()).filter(Boolean)
      : undefined;

    const effectiveTz = timezone || resolveEffectiveTimezone(user);

    const scheduled = await scheduledEmailWorker.createScheduledEmail({
      userId: user.id,
      accountId,
      to: toArray,
      cc: ccArray,
      bcc: bccArray,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      threadId,
      scheduledAt: scheduledDate,
      timezone: effectiveTz,
      attachments,
    });

    return NextResponse.json({
      success: true,
      scheduled: true,
      scheduledId: scheduled.id,
      scheduledAt: scheduled.scheduledAt.toISOString(),
      timezone: scheduled.timezone,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
