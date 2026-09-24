import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import caldavWorker from "@/server/caldav-worker";
import eventBus from "@/server/event-bus";
import { CALENDAR_PALETTE } from "@/lib/calendar-colors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser();
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
        const isGoogle =
          acc.emailAddress.toLowerCase().endsWith("@gmail.com") ||
          acc.emailAddress.toLowerCase().endsWith("@googlemail.com") ||
          (Boolean(acc.imapHost) && acc.imapHost!.toLowerCase().includes("google"));

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
          emailLower.endsWith("@gmail.com") ||
          emailLower.endsWith("@googlemail.com") ||
          emailLower.endsWith("@purelymail.com") ||
          emailLower.endsWith("@icloud.com") ||
          emailLower.endsWith("@me.com") ||
          emailLower.endsWith("@mac.com") ||
          emailLower.endsWith("@fastmail.com") ||
          emailLower.endsWith("@yahoo.com") ||
          emailLower.endsWith("@zoho.com") ||
          emailLower.endsWith("@mailbox.org") ||
          emailLower.endsWith("@posteo.de") ||
          emailLower.endsWith("@gmx.net") ||
          emailLower.endsWith("@gmx.de") ||
          emailLower.endsWith("@web.de") ||
          imapLower.includes("google") ||
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

    const where: any = {
      calendar: {
        account: {
          userId: user.id,
        },
      },
    };

    if (calendarId) {
      where.calendarId = calendarId;
    }

    if (startStr && endStr) {
      where.startDate = { lte: new Date(endStr) };
      where.endDate = { gte: new Date(startStr) };
    }

    const events = await prisma.calendarEvent.findMany({
      where,
      include: {
        calendar: {
          select: {
            id: true,
            name: true,
            color: true,
            accountId: true,
          },
        },
      },
      orderBy: { startDate: "asc" },
    });

    return NextResponse.json({ calendars, events });
  } catch (error: any) {
    console.error("Error fetching calendar:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser();
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
