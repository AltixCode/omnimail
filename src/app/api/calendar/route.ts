import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import caldavWorker, { isGoogleAccount } from "@/server/caldav-worker";
import ICAL from "ical.js";
import eventBus from "@/server/event-bus";
import { CALENDAR_PALETTE } from "@/lib/calendar-colors";
import { icalTimeToUTC, normalizeTimezone } from "@/lib/timezone";
import { sendEmail } from "@/server/smtp-dispatcher";
import { format } from "date-fns";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { searchParams } = new URL(req.url);
    const calendarId = searchParams.get("calendarId") || undefined;
    const accountId = searchParams.get("accountId") || undefined;
    const startStr = searchParams.get("start");
    const endStr = searchParams.get("end");

    const userAccounts = await prisma.mailAccount.findMany({
      where: {
        userId: user.id,
        ...(accountId ? { id: accountId } : {}),
      },
      select: {
        id: true,
        label: true,
        emailAddress: true,
        caldavUrl: true,
        imapHost: true,
      },
    });

    let calendars = await prisma.calendar.findMany({
      where: {
        account: {
          userId: user.id,
          ...(accountId ? { id: accountId } : {}),
        },
      },
      include: {
        account: {
          select: {
            id: true,
            label: true,
            emailAddress: true,
          },
        },
      },
    });

    // Ensure differentiated distinct colors across all calendars
    const usedColors = new Set<string>();
    for (let i = 0; i < calendars.length; i++) {
      const cal = calendars[i];
      if (!cal.color || cal.color === "#3b82f6" || usedColors.has(cal.color)) {
        let chosenColor = CALENDAR_PALETTE[i % CALENDAR_PALETTE.length];
        for (const candidate of CALENDAR_PALETTE) {
          if (!usedColors.has(candidate)) {
            chosenColor = candidate;
            break;
          }
        }
        cal.color = chosenColor;
        usedColors.add(chosenColor);
        prisma.calendar
          .update({
            where: { id: cal.id },
            data: { color: chosenColor },
          })
          .catch(() => {});
      } else {
        usedColors.add(cal.color);
      }
    }

    // Ensure EVERY account has at least one calendar record
    const accountIdsWithCal = new Set(calendars.map((c) => c.accountId));

    for (let i = 0; i < userAccounts.length; i++) {
      const acc = userAccounts[i];
      if (!accountIdsWithCal.has(acc.id)) {
        const isGoogle = isGoogleAccount(acc);

        const calName = isGoogle
          ? `${acc.label || acc.emailAddress} (Google)`
          : (acc.label || acc.emailAddress);

        let chosenColor = CALENDAR_PALETTE[i % CALENDAR_PALETTE.length];
        for (const candidate of CALENDAR_PALETTE) {
          if (!usedColors.has(candidate)) {
            chosenColor = candidate;
            break;
          }
        }
        usedColors.add(chosenColor);

        const newCal = await prisma.calendar.create({
          data: {
            accountId: acc.id,
            name: calName,
            color: chosenColor,
            caldavUrl: acc.caldavUrl || "",
          },
          include: {
            account: {
              select: {
                id: true,
                label: true,
                emailAddress: true,
              },
            },
          },
        });
        calendars.push(newCal);
        accountIdsWithCal.add(acc.id);

        const emailLower = acc.emailAddress.toLowerCase();
        const imapLower = (acc.imapHost || "").toLowerCase();
        const hasCalendarSupport =
          Boolean(acc.caldavUrl) ||
          isGoogleAccount(acc) ||
          emailLower.endsWith("@purelymail.com") ||
          emailLower.endsWith("@icloud.com") ||
          emailLower.endsWith("@me.com") ||
          emailLower.endsWith("@mac.com") ||
          emailLower.endsWith("@fastmail.com") ||
          emailLower.endsWith("@yahoo.com") ||
          emailLower.endsWith("@zoho.com") ||
          emailLower.endsWith("@mailbox.org") ||
          emailLower.endsWith("@posteo.de") ||
          emailLower.endsWith("@posteo.net") ||
          emailLower.endsWith("@gmx.net") ||
          emailLower.endsWith("@gmx.de") ||
          emailLower.endsWith("@web.de") ||
          imapLower.includes("purelymail") ||
          imapLower.includes("mail.me.com") ||
          imapLower.includes("fastmail") ||
          imapLower.includes("yahoo") ||
          imapLower.includes("zoho") ||
          imapLower.includes("mailbox.org") ||
          imapLower.includes("posteo") ||
          imapLower.includes("gmx") ||
          imapLower.includes("web.de");

        if (hasCalendarSupport) {
          caldavWorker.syncAccount(acc.id).catch(() => {});
        }
      }
    }

    // Recurrence window: defaults to 2 months prior and 6 months ahead if not specified
    const now = new Date();
    const rangeStart = startStr ? new Date(startStr) : new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const rangeEnd = endStr ? new Date(endStr) : new Date(now.getFullYear(), now.getMonth() + 6, 1);

    const baseWhere: any = {
      calendar: {
        account: {
          userId: user.id,
        },
      },
    };

    if (calendarId) {
      baseWhere.calendarId = calendarId;
    }

    const dbEvents = await prisma.calendarEvent.findMany({
      where: {
        ...baseWhere,
        OR: [
          // Non-recurring events within range
          {
            rrule: null,
            startDate: { lte: rangeEnd },
            endDate: { gte: rangeStart },
          },
          // Recurring events that started on or before rangeEnd
          {
            rrule: { not: null },
            startDate: { lte: rangeEnd },
          },
        ],
      },
      include: {
        calendar: {
          select: {
            id: true,
            name: true,
            color: true,
            accountId: true,
            account: {
              select: {
                id: true,
                label: true,
                emailAddress: true,
              },
            },
          },
        },
      },
      orderBy: { startDate: "asc" },
    });

    const finalEvents: any[] = [];
    const exceptionMap = new Set<string>();

    // Index all explicit recurrence exceptions (which carry # in uid)
    for (const ev of dbEvents) {
      if (ev.uid.includes("#")) {
        const [baseUid, recurrenceId] = ev.uid.split("#");
        exceptionMap.add(`${baseUid}_${ev.startDate.toISOString().slice(0, 10)}`);
        if (recurrenceId) {
          const dateMatch = recurrenceId.match(/(\d{4})-?(\d{2})-?(\d{2})/);
          if (dateMatch) {
            exceptionMap.add(`${baseUid}_${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          }
        }
      }
    }

    for (const ev of dbEvents) {
      let tzid = (ev as any).timezone || null;
      let comp: any = null;
      if (ev.rawIcs) {
        try {
          const jcal = ICAL.parse(ev.rawIcs.startsWith("BEGIN:VCALENDAR") ? ev.rawIcs : `BEGIN:VCALENDAR\n${ev.rawIcs}\nEND:VCALENDAR`);
          comp = new ICAL.Component(jcal);
          const vcomp = comp.name === "vevent" ? comp : comp.getFirstSubcomponent("vevent");
          if (!tzid && vcomp) {
            tzid = normalizeTimezone(vcomp.getFirstProperty("dtstart")?.getParameter("tzid"));
          }
        } catch {}
      }

      if (!ev.rrule) {
        let finalStart = ev.startDate;
        let finalEnd = ev.endDate;
        if (comp) {
          try {
            const vcomp = comp.name === "vevent" ? comp : comp.getFirstSubcomponent("vevent");
            if (vcomp) {
              const dtstart = vcomp.getFirstProperty("dtstart");
              const dtend = vcomp.getFirstProperty("dtend");
              if (dtstart) {
                const converted = icalTimeToUTC(dtstart.getFirstValue(), tzid);
                if (converted.date) finalStart = converted.date;
                if (!tzid && converted.timezone) tzid = converted.timezone;
              }
              if (dtend) {
                const converted = icalTimeToUTC(dtend.getFirstValue(), tzid);
                if (converted.date) finalEnd = converted.date;
              }
            }
          } catch {}
        }

        finalEvents.push({
          ...ev,
          startDate: finalStart,
          endDate: finalEnd,
          timezone: tzid,
        });
        continue;
      }

      // Expand recurring event instances within [rangeStart, rangeEnd]
      try {
        if (!comp) {
          const vcal = new ICAL.Component(["vcalendar", [], []]);
          const vevent = new ICAL.Component("vevent");
          vevent.addPropertyWithValue("uid", ev.uid);
          vevent.addPropertyWithValue("summary", ev.summary);
          vevent.addPropertyWithValue("dtstart", ICAL.Time.fromJSDate(ev.startDate, false));
          vevent.addPropertyWithValue("dtend", ICAL.Time.fromJSDate(ev.endDate, false));
          vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(ev.rrule));
          vcal.addSubcomponent(vevent);
          comp = vcal;
        }

        const veventComp = comp.name === "vevent" ? comp : comp.getFirstSubcomponent("vevent");
        if (!veventComp) {
          if (ev.startDate <= rangeEnd && ev.endDate >= rangeStart) {
            finalEvents.push({ ...ev, timezone: tzid });
          }
          continue;
        }

        const icalEvent = new ICAL.Event(veventComp);
        const durationMs = icalEvent.duration
          ? icalEvent.duration.toSeconds() * 1000
          : (ev.endDate.getTime() - ev.startDate.getTime());
        const iter = icalEvent.iterator();
        let next: any;
        let occurrenceCount = 0;
        const maxOccurrences = 400;

        while ((next = iter.next()) && occurrenceCount < maxOccurrences) {
          const { date: occDate } = icalTimeToUTC(next, tzid);
          if (occDate > rangeEnd) break;
          if (occDate >= rangeStart) {
            const dateKey = `${ev.uid}_${occDate.toISOString().slice(0, 10)}`;
            if (!exceptionMap.has(dateKey)) {
              finalEvents.push({
                ...ev,
                id: `${ev.id}_${occDate.getTime()}`,
                startDate: occDate,
                endDate: new Date(occDate.getTime() + durationMs),
                timezone: tzid,
              });
            }
          }
          occurrenceCount++;
        }
      } catch (err) {
        console.error("Error expanding event recurrence:", ev.summary, err);
        if (ev.startDate <= rangeEnd && ev.endDate >= rangeStart) {
          finalEvents.push({ ...ev, timezone: tzid });
        }
      }
    }

    finalEvents.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    return NextResponse.json({ calendars, events: finalEvents });
  } catch (error: any) {
    console.error("Error fetching calendar:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();

    const {
      calendarId,
      accountId,
      summary,
      description,
      location,
      startDate,
      endDate,
      isAllDay = false,
      rrule,
      guests = [],
      meetingLink,
      sendInvites = true,
    } = body;

    if (!summary || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required event fields (summary, startDate, endDate)" },
        { status: 400 }
      );
    }

    let targetCalendarId = calendarId;
    let calendar: any = null;

    if (targetCalendarId) {
      calendar = await prisma.calendar.findFirst({
        where: {
          id: targetCalendarId,
          account: { userId: user.id },
        },
        include: { account: true },
      });
    }

    if (!calendar) {
      calendar = await prisma.calendar.findFirst({
        where: {
          account: {
            userId: user.id,
            ...(accountId ? { id: accountId } : {}),
          },
        },
        include: { account: true },
      });

      if (!calendar) {
        const account = await prisma.mailAccount.findFirst({
          where: { userId: user.id },
        });

        if (!account) {
          return NextResponse.json(
            { error: "No account found to associate calendar with" },
            { status: 400 }
          );
        }

        calendar = await prisma.calendar.create({
          data: {
            accountId: account.id,
            name: "Default Calendar",
            color: "#3b82f6",
            caldavUrl: "",
          },
          include: { account: true },
        });
      }

      targetCalendarId = calendar.id;
    }

    // Parse and normalize guests
    let guestList: string[] = [];
    if (Array.isArray(guests)) {
      guestList = guests
        .map((g: any) => (typeof g === "string" ? g.trim() : g?.email || "").toLowerCase())
        .filter((g: string) => g && g.includes("@"));
    } else if (typeof guests === "string") {
      guestList = guests
        .split(/[,;\n]/)
        .map((g) => g.trim().toLowerCase())
        .filter((g) => g && g.includes("@"));
    }
    guestList = Array.from(new Set(guestList));

    let finalLocation = (location || "").trim();
    let finalDescription = (description || "").trim();

    if (meetingLink && meetingLink.trim()) {
      const cleanLink = meetingLink.trim();
      if (!finalLocation) {
        finalLocation = cleanLink;
      }
      if (!finalDescription.includes(cleanLink)) {
        finalDescription = finalDescription
          ? `${finalDescription}\n\nVideo Meeting: ${cleanLink}`
          : `Video Meeting: ${cleanLink}`;
      }
    }

    const eventUid = `omnimail-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@omnimail.app`;
    const startD = new Date(startDate);
    const endD = new Date(endDate);

    const formatIcalDate = (d: Date, allDay?: boolean) => {
      if (allDay) {
        return d.toISOString().slice(0, 10).replace(/-/g, "");
      }
      return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    };

    const dtStamp = formatIcalDate(new Date());
    const dtStart = formatIcalDate(startD, isAllDay);
    const dtEnd = formatIcalDate(endD, isAllDay);

    const dtStartLine = isAllDay
      ? `DTSTART;VALUE=DATE:${dtStart}`
      : `DTSTART:${dtStart}`;
    const dtEndLine = isAllDay
      ? `DTEND;VALUE=DATE:${dtEnd}`
      : `DTEND:${dtEnd}`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OmniMail//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${eventUid}`,
      `DTSTAMP:${dtStamp}`,
      dtStartLine,
      dtEndLine,
      `SUMMARY:${summary.replace(/[\r\n]+/g, " ")}`,
    ];

    const organizerEmail = calendar.account?.emailAddress;
    const organizerName = calendar.account?.label || organizerEmail;
    if (organizerEmail) {
      lines.push(`ORGANIZER;CN="${organizerName.replace(/"/g, "")}":mailto:${organizerEmail}`);
    }

    for (const g of guestList) {
      lines.push(
        `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="${g}":mailto:${g}`
      );
    }

    if (rrule) {
      lines.push(`RRULE:${rrule.replace(/^RRULE:/i, "")}`);
    }

    if (finalDescription) {
      lines.push(`DESCRIPTION:${finalDescription.replace(/\r?\n/g, "\\n")}`);
    }

    if (finalLocation) {
      lines.push(`LOCATION:${finalLocation.replace(/[\r\n]+/g, " ")}`);
    }

    lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
    const icsData = lines.join("\r\n");

    const newEvent = await prisma.calendarEvent.create({
      data: {
        calendarId: targetCalendarId,
        uid: eventUid,
        summary,
        description: finalDescription || null,
        location: finalLocation || null,
        startDate: startD,
        endDate: endD,
        isAllDay: Boolean(isAllDay),
        rrule: rrule || null,
        rawIcs: icsData,
      },
      include: {
        calendar: {
          include: {
            account: true,
          },
        },
      },
    });

    caldavWorker
      .pushEventToRemote(targetCalendarId, {
        ...newEvent,
        rawIcs: icsData,
        organizer: organizerEmail,
        attendees: guestList,
      })
      .catch((err) => {
        console.warn("Background CalDAV push error:", err);
      });

    // Send invitations to guests
    if (sendInvites && guestList.length > 0 && calendar.account) {
      try {
        const dateRangeStr = isAllDay
          ? format(startD, "EEEE, MMMM d, yyyy (All day)")
          : `${format(startD, "EEEE, MMMM d, yyyy · p")} – ${format(endD, "p")}`;

        const inviteHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px;">
              <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #3b82f6;">Calendar Invitation</span>
              <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 6px 0 0 0;">${escapeHtml(summary)}</h1>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 13px; font-weight: 600; width: 90px; vertical-align: top;">When</td>
                <td style="padding: 6px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${escapeHtml(dateRangeStr)}</td>
              </tr>
              ${
                finalLocation
                  ? `
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top;">Where</td>
                <td style="padding: 6px 0; color: #1e293b; font-size: 14px;">
                  ${
                    finalLocation.startsWith("http")
                      ? `<a href="${escapeHtml(finalLocation)}" style="color: #2563eb; text-decoration: underline;">${escapeHtml(finalLocation)}</a>`
                      : escapeHtml(finalLocation)
                  }
                </td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top;">Organizer</td>
                <td style="padding: 6px 0; color: #1e293b; font-size: 14px;">${escapeHtml(organizerName)} &lt;${escapeHtml(organizerEmail)}&gt;</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-size: 13px; font-weight: 600; vertical-align: top;">Guests</td>
                <td style="padding: 6px 0; color: #1e293b; font-size: 14px;">${guestList.map(escapeHtml).join(", ")}</td>
              </tr>
            </table>

            ${
              finalDescription
                ? `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 20px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Details</div>
              <div style="font-size: 13px; color: #334155; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(finalDescription)}</div>
            </div>`
                : ""
            }

            <div style="border-top: 1px solid #f1f5f9; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
              Sent via OmniMail Calendar
            </div>
          </div>
        `;

        await sendEmail({
          accountId: calendar.account.id,
          to: guestList,
          subject: `Invitation: ${summary}`,
          bodyHtml: inviteHtml,
          bodyText: `Invitation: ${summary}\nWhen: ${dateRangeStr}\n${finalLocation ? `Where: ${finalLocation}\n` : ""}Organizer: ${organizerEmail}\nGuests: ${guestList.join(", ")}\n\n${finalDescription || ""}`,
          icalEvent: {
            method: "REQUEST",
            content: icsData,
            filename: "invite.ics",
          },
          attachments: [
            {
              filename: "invite.ics",
              content: Buffer.from(icsData).toString("base64"),
              contentType: "text/calendar; method=REQUEST; charset=UTF-8",
            },
          ],
        });
      } catch (inviteErr) {
        console.error("Failed to dispatch invitation email:", inviteErr);
      }
    }

    eventBus.broadcast("calendar-updated", {
      calendarId: targetCalendarId,
      eventId: newEvent.id,
    });

    return NextResponse.json({ success: true, event: newEvent });
  } catch (error: any) {
    console.error("Error creating calendar event:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
