import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import {
  parseCalendarInviteFromAttachments,
  buildRsvpIcs,
} from "@/lib/calendar-invite";
import { sendEmail } from "@/server/smtp-dispatcher";
import eventBus from "@/server/event-bus";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser();
    const body = await req.json();
    const {
      messageId,
      action, // "accept" | "tentative" | "decline"
      calendarId,
    } = body as {
      messageId: string;
      action: "accept" | "tentative" | "decline";
      calendarId?: string;
    };

    if (!messageId || !action || !["accept", "tentative", "decline"].includes(action)) {
      return NextResponse.json(
        { error: "Missing or invalid parameters: messageId and action ('accept' | 'tentative' | 'decline') required" },
        { status: 400 }
      );
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        account: true,
        attachments: true,
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const invite = parseCalendarInviteFromAttachments(message.attachments);
    if (!invite) {
      return NextResponse.json(
        { error: "No calendar invitation (.ics) found in this message" },
        { status: 400 }
      );
    }

    // 1. Locate or create calendar for this account
    let targetCalendar = calendarId
      ? await prisma.calendar.findUnique({ where: { id: calendarId } })
      : await prisma.calendar.findFirst({
          where: { accountId: message.accountId },
        });

    if (!targetCalendar) {
      targetCalendar = await prisma.calendar.create({
        data: {
          accountId: message.accountId,
          name: `${message.account.label || message.account.emailAddress} Calendar`,
          color: "#2563eb",
          caldavUrl: message.account.caldavUrl || "",
        },
      });
    }

    let savedEvent = null;

    // 2. Handle Accept / Tentative -> Add/Update Event in Calendar
    if (action === "accept" || action === "tentative") {
      savedEvent = await prisma.calendarEvent.upsert({
        where: {
          calendarId_uid: {
            calendarId: targetCalendar.id,
            uid: invite.uid,
          },
        },
        update: {
          summary: invite.summary,
          description: invite.description,
          location: invite.location,
          startDate: new Date(invite.startDate),
          endDate: new Date(invite.endDate),
          isAllDay: invite.isAllDay,
          rrule: invite.rrule,
          rawIcs: invite.rawIcs,
        },
        create: {
          calendarId: targetCalendar.id,
          uid: invite.uid,
          summary: invite.summary,
          description: invite.description,
          location: invite.location,
          startDate: new Date(invite.startDate),
          endDate: new Date(invite.endDate),
          isAllDay: invite.isAllDay,
          rrule: invite.rrule,
          rawIcs: invite.rawIcs,
        },
      });
    } else if (action === "decline") {
      // 3. Handle Decline -> remove event if it was previously accepted on calendar
      await prisma.calendarEvent.deleteMany({
        where: {
          calendarId: targetCalendar.id,
          uid: invite.uid,
        },
      });
    }

    // 4. Send RFC 5546 iMIP RSVP Email back to organizer if organizer email exists
    if (invite.organizer?.email && message.account.smtpHost && message.account.smtpUser) {
      const actionSubjectMap = {
        accept: `Accepted: ${invite.summary}`,
        tentative: `Tentative: ${invite.summary}`,
        decline: `Declined: ${invite.summary}`,
      };

      const actionVerbMap = {
        accept: "accepted",
        tentative: "tentatively accepted",
        decline: "declined",
      };

      const userDisplayName = message.account.label || message.account.emailAddress;
      const rsvpIcsContent = buildRsvpIcs({
        uid: invite.uid,
        summary: invite.summary,
        startDate: invite.startDate,
        endDate: invite.endDate,
        organizerEmail: invite.organizer.email,
        userEmail: message.account.emailAddress,
        userName: userDisplayName,
        action,
      });

      const readableDate = new Date(invite.startDate).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      const bodyText = `${userDisplayName} has ${actionVerbMap[action]} this invitation:\n\n` +
        `Event: ${invite.summary}\n` +
        `When: ${readableDate}\n` +
        (invite.location ? `Where: ${invite.location}\n` : "") +
        `\nSent via OmniMail.`;

      const bodyHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
          <p><strong>${userDisplayName}</strong> has ${actionVerbMap[action]} this invitation:</p>
          <div style="background: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <h3 style="margin: 0 0 6px 0; color: #0f172a; font-size: 15px;">${invite.summary}</h3>
            <p style="margin: 0; color: #475569; font-size: 13px;"><strong>When:</strong> ${readableDate}</p>
            ${invite.location ? `<p style="margin: 4px 0 0 0; color: #475569; font-size: 13px;"><strong>Where:</strong> ${invite.location}</p>` : ""}
          </div>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">Sent via OmniMail</p>
        </div>
      `;

      // Dispatch SMTP reply in background so UI response is sub-second
      sendEmail({
        accountId: message.accountId,
        to: [invite.organizer.email],
        subject: actionSubjectMap[action],
        bodyText,
        bodyHtml,
        inReplyTo: message.messageId || undefined,
        threadId: message.threadId || undefined,
        attachments: [
          {
            filename: "invite.ics",
            content: Buffer.from(rsvpIcsContent).toString("base64"),
            contentType: "text/calendar; method=REPLY; charset=UTF-8",
          },
        ],
      }).catch((smtpErr) => {
        console.error("Failed to dispatch RSVP reply email to organizer:", smtpErr);
      });
    }

    // 5. Broadcast real-time update to all active calendar views
    eventBus.broadcast("calendar-updated", {
      accountId: message.accountId,
      calendarId: targetCalendar.id,
      action,
      uid: invite.uid,
    });

    return NextResponse.json({
      success: true,
      action,
      calendarId: targetCalendar.id,
      event: savedEvent,
    });
  } catch (error: any) {
    console.error("Error processing calendar invite action:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
