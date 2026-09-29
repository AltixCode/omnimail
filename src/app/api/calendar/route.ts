import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import caldavWorker, { isGoogleAccount } from "@/server/caldav-worker";
import ICAL from "ical.js";
import eventBus from "@/server/event-bus";
import { CALENDAR_PALETTE } from "@/lib/calendar-colors";

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
        const [baseUid] = ev.uid.split("#");
        exceptionMap.add(`${baseUid}_${ev.startDate.toISOString().slice(0, 10)}`);
      }
    }

    for (const ev of dbEvents) {
      if (!ev.rrule) {
        finalEvents.push(ev);
        continue;
      }

      // Expand recurring event instances within [rangeStart, rangeEnd]
      try {
        let comp: any;
        if (ev.rawIcs) {
          try {
            const jcal = ICAL.parse(ev.rawIcs.startsWith("BEGIN:VCALENDAR") ? ev.rawIcs : `BEGIN:VCALENDAR\n${ev.rawIcs}\nEND:VCALENDAR`);
            comp = new ICAL.Component(jcal);
          } catch {}
        }

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
            finalEvents.push(ev);
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
          const occDate = next.toJSDate();
          if (occDate > rangeEnd) break;
          if (occDate >= rangeStart) {
            const dateKey = `${ev.uid}_${occDate.toISOString().slice(0, 10)}`;
            if (!exceptionMap.has(dateKey)) {
              finalEvents.push({
                ...ev,
                id: `${ev.id}_${occDate.getTime()}`,
                startDate: occDate,
                endDate: new Date(occDate.getTime() + durationMs),
              });
            }
          }
          occurrenceCount++;
        }
      } catch (err) {
        console.error("Error expanding event recurrence:", ev.summary, err);
        if (ev.startDate <= rangeEnd && ev.endDate >= rangeStart) {
          finalEvents.push(ev);
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
    } = body;

    if (!summary || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing required event fields (summary, startDate, endDate)" },
        { status: 400 }
      );
    }

    let targetCalendarId = calendarId;

    if (!targetCalendarId) {
      // Find or create default calendar for account
      let calendar = await prisma.calendar.findFirst({
        where: {
          account: {
            userId: user.id,
            ...(accountId ? { id: accountId } : {}),
          },
        },
      });

      if (!calendar) {
        // Find user account or create fallback calendar
        const account = await prisma.mailAccount.findFirst({
          where: { userId: user.id },
        });

        if (!account) {
          return NextResponse.json({ error: "No account found to associate calendar with" }, { status: 400 });
        }

        calendar = await prisma.calendar.create({
          data: {
            accountId: account.id,
            name: "Default Calendar",
            color: "#3b82f6",
            caldavUrl: "",
          },
        });
      }

      targetCalendarId = calendar.id;
    }

    const newEvent = await prisma.calendarEvent.create({
      data: {
        calendarId: targetCalendarId,
        uid: `omnimail-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        summary,
        description: description || null,
        location: location || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isAllDay: Boolean(isAllDay),
        rrule: rrule || null,
      },
      include: {
        calendar: true,
      },
    });

    caldavWorker.pushEventToRemote(targetCalendarId, newEvent).catch((err) => {
      console.warn("Background CalDAV push error:", err);
    });

    eventBus.broadcast("calendar-updated", { calendarId: targetCalendarId, eventId: newEvent.id });

    return NextResponse.json({ success: true, event: newEvent });
  } catch (error: any) {
    console.error("Error creating calendar event:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
