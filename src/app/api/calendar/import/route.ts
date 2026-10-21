import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import caldavWorker from "@/server/caldav-worker";
import ICAL from "ical.js";
import eventBus from "@/server/event-bus";
import { icalTimeToUTC, normalizeTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);

    let calendarId = "";
    let icsContent = "";

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      calendarId = (formData.get("calendarId") as string) || "";
      const file = formData.get("file");
      if (file && typeof file === "object" && "text" in file) {
        icsContent = await (file as Blob).text();
      } else if (typeof file === "string") {
        icsContent = file;
      }
    } else {
      const body = await req.json();
      calendarId = body.calendarId || "";
      icsContent = body.icsContent || body.content || "";
    }

    if (!icsContent || !icsContent.trim()) {
      return NextResponse.json(
        { error: "No iCalendar (.ics) content provided" },
        { status: 400 }
      );
    }

    // Verify calendar belongs to this user
    let calendar: any = null;
    if (calendarId) {
      calendar = await prisma.calendar.findFirst({
        where: {
          id: calendarId,
          account: { userId: user.id },
        },
        include: { account: true },
      });
    }

    if (!calendar) {
      // Find default or first calendar of user
      calendar = await prisma.calendar.findFirst({
        where: {
          account: { userId: user.id },
        },
        include: { account: true },
      });

      if (!calendar) {
        const account = await prisma.mailAccount.findFirst({
          where: { userId: user.id },
        });

        if (!account) {
          return NextResponse.json(
            { error: "No email or calendar account found to import into" },
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
    }

    const targetCalendarId = calendar.id;

    // Parse ICS content
    let jcal: any;
    try {
      jcal = ICAL.parse(icsContent.trim());
    } catch (parseErr: any) {
      return NextResponse.json(
        { error: `Invalid iCalendar file format: ${parseErr.message}` },
        { status: 400 }
      );
    }

    const comp = new ICAL.Component(jcal);
    const vevents =
      comp.name === "vevent"
        ? [comp]
        : comp.getAllSubcomponents("vevent");

    if (!vevents || vevents.length === 0) {
      return NextResponse.json(
        { error: "No calendar events (VEVENT) found in the uploaded file" },
        { status: 400 }
      );
    }

    const imported: any[] = [];
    const now = new Date();

    for (let i = 0; i < vevents.length; i++) {
      const v = vevents[i];
      try {
        const uidProp = v.getFirstProperty("uid");
        const uid = String(
          (uidProp ? uidProp.getFirstValue() : "") ||
            `omnimail-import-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
        );

        const summaryProp = v.getFirstProperty("summary");
        const summary = String(
          (summaryProp ? summaryProp.getFirstValue() : "") || "(No Title)"
        );

        const descProp = v.getFirstProperty("description");
        const description = descProp ? String(descProp.getFirstValue() || "") : null;

        const locProp = v.getFirstProperty("location");
        const location = locProp ? String(locProp.getFirstValue() || "") : null;

        const dtstartProp = v.getFirstProperty("dtstart");
        const dtendProp = v.getFirstProperty("dtend");

        if (!dtstartProp) {
          continue; // Skip events without start date
        }

        const tzidParam = dtstartProp.getParameter("tzid");
        const tzidVal =
          typeof tzidParam === "string"
            ? tzidParam
            : String(v.getFirstPropertyValue("tzid") || "");
        const tzid = normalizeTimezone(tzidVal || undefined);

        const dtstartVal: any = dtstartProp.getFirstValue();
        const isStartAllDay = Boolean(
          dtstartVal?.isDate || dtstartProp.type === "date"
        );
        const { date: startDate } = icalTimeToUTC(dtstartVal, tzid);

        let endDate = startDate;
        let isEndAllDay = isStartAllDay;

        if (dtendProp) {
          const dtendVal: any = dtendProp.getFirstValue();
          isEndAllDay = Boolean(dtendVal?.isDate || dtendProp.type === "date");
          const endRes = icalTimeToUTC(dtendVal, tzid);
          endDate = endRes.date;
        } else {
          const durationProp = v.getFirstProperty("duration");
          if (durationProp) {
            try {
              const dur: any = durationProp.getFirstValue();
              const durSeconds =
                dur && typeof dur.toSeconds === "function" ? dur.toSeconds() : 3600;
              endDate = new Date(startDate.getTime() + durSeconds * 1000);
            } catch {
              endDate = new Date(startDate.getTime() + 3600 * 1000);
            }
          } else {
            endDate = isStartAllDay
              ? new Date(startDate.getTime() + 24 * 3600 * 1000)
              : new Date(startDate.getTime() + 3600 * 1000);
          }
        }

        const isAllDay = Boolean(isStartAllDay || isEndAllDay);

        const rruleProp = v.getFirstProperty("rrule");
        const rrule = rruleProp ? rruleProp.getFirstValue()?.toString() : null;

        // Wrap the single event in standard VCALENDAR for rawIcs
        const singleCal = new ICAL.Component(["vcalendar", [], []]);
        singleCal.addPropertyWithValue("version", "2.0");
        singleCal.addPropertyWithValue("prodid", "-//OmniMail//EN");
        singleCal.addSubcomponent(v);
        const eventIcs = singleCal.toString();

        const upserted = await prisma.calendarEvent.upsert({
          where: {
            calendarId_uid: {
              calendarId: targetCalendarId,
              uid,
            },
          },
          update: {
            summary,
            description: description || null,
            location: location || null,
            startDate,
            endDate,
            isAllDay,
            timezone: tzid || null,
            rrule: rrule || null,
            rawIcs: eventIcs,
            updatedAt: now,
          },
          create: {
            calendarId: targetCalendarId,
            uid,
            summary,
            description: description || null,
            location: location || null,
            startDate,
            endDate,
            isAllDay,
            timezone: tzid || null,
            rrule: rrule || null,
            rawIcs: eventIcs,
          },
        });

        imported.push(upserted);

        // Push to remote CalDAV if sync is configured
        caldavWorker
          .pushEventToRemote(targetCalendarId, {
            ...upserted,
            rawIcs: eventIcs,
          })
          .catch(() => {});
      } catch (eventErr) {
        console.warn("Failed to parse single event during import:", eventErr);
      }
    }

    eventBus.broadcast("calendar-updated", {
      calendarId: targetCalendarId,
      importedCount: imported.length,
    });

    return NextResponse.json({
      success: true,
      count: imported.length,
      calendar: {
        id: calendar.id,
        name: calendar.name,
        account: calendar.account
          ? {
              id: calendar.account.id,
              label: calendar.account.label,
              emailAddress: calendar.account.emailAddress,
            }
          : null,
      },
      events: imported,
    });
  } catch (error: any) {
    console.error("Error importing calendar:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
