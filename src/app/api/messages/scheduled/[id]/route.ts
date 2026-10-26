import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import scheduledEmailWorker from "@/server/scheduled-worker";
import { resolveEffectiveTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;

    const message = await scheduledEmailWorker.getScheduledEmailDetail(id, user.id);
    if (!message) {
      return NextResponse.json({ error: "Scheduled email not found" }, { status: 404 });
    }

    return NextResponse.json({
      message,
      thread: [message],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;
    const body = await req.json();

    const cleanId = id.startsWith("sched_") ? id.slice(6) : id;

    const {
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      scheduledAt,
      timezone,
      attachments,
    } = body;

    const updatePayload: any = {};
    if (accountId) updatePayload.accountId = accountId;
    if (to) {
      updatePayload.to = Array.isArray(to)
        ? to
        : to.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    if (cc !== undefined) {
      updatePayload.cc = cc
        ? Array.isArray(cc)
          ? cc
          : cc.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
    }
    if (bcc !== undefined) {
      updatePayload.bcc = bcc
        ? Array.isArray(bcc)
          ? bcc
          : bcc.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
    }
    if (subject !== undefined) updatePayload.subject = subject;
    if (bodyText !== undefined) updatePayload.bodyText = bodyText;
    if (bodyHtml !== undefined) updatePayload.bodyHtml = bodyHtml;
    if (scheduledAt !== undefined) {
      const parsedDate = new Date(scheduledAt);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json({ error: "Invalid scheduledAt timestamp." }, { status: 400 });
      }
      if (parsedDate.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Scheduled send time must be in the future." }, { status: 400 });
      }
      updatePayload.scheduledAt = parsedDate;
    }
    if (timezone !== undefined) {
      updatePayload.timezone = timezone || resolveEffectiveTimezone(user);
    }
    if (attachments !== undefined) {
      updatePayload.attachments = attachments;
    }

    const updated = await scheduledEmailWorker.updateScheduledEmail(
      cleanId,
      user.id,
      updatePayload
    );

    return NextResponse.json({
      success: true,
      scheduledEmail: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;
    const cleanId = id.startsWith("sched_") ? id.slice(6) : id;

    await scheduledEmailWorker.deleteScheduledEmail(cleanId, user.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
