import ICAL from "ical.js";
import prisma from "@/lib/db";

export interface CalendarAttendee {
  name: string;
  email: string;
  partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE" | "NEEDS-ACTION";
  role?: string;
}

export interface ParsedCalendarInvite {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  isMeetingLink: boolean;
  meetingLink: string | null;
  startDate: string; // ISO string
  endDate: string;   // ISO string
  isAllDay: boolean;
  organizer: {
    name: string;
    email: string;
  } | null;
  attendees: CalendarAttendee[];
  method: "REQUEST" | "REPLY" | "CANCEL" | "PUBLISH";
  rrule: string | null;
  rawIcs: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}

/**
 * Searches message attachments for an .ics / text/calendar file and parses the VEVENT
 */
export function parseCalendarInviteFromAttachments(
  attachments: Array<{
    filename: string;
    contentType: string;
    dataBase64?: string | null;
  }>
): ParsedCalendarInvite | null {
  if (!attachments || attachments.length === 0) return null;

  const calendarAtt = attachments.find((att) => {
    const fn = (att.filename || "").toLowerCase();
    const ct = (att.contentType || "").toLowerCase();
    return (
      ct.includes("calendar") ||
      ct.includes("application/ics") ||
      fn.endsWith(".ics") ||
      fn.endsWith(".ical")
    );
  });

  if (!calendarAtt || !calendarAtt.dataBase64) return null;

  try {
    const rawIcs = Buffer.from(calendarAtt.dataBase64, "base64").toString("utf8");
    return parseIcsString(rawIcs);
  } catch (err) {
    console.error("Failed to parse calendar invite attachment:", err);
    return null;
  }
}

/**
 * Parses raw iCalendar text into a structured ParsedCalendarInvite object
 */
export function parseIcsString(rawIcs: string): ParsedCalendarInvite | null {
  try {
    const jcalData = ICAL.parse(rawIcs);
    const comp = new ICAL.Component(jcalData);

    const methodProp = comp.getFirstProperty("method");
    const methodStr = methodProp ? String(methodProp.getFirstValue()).toUpperCase() : "REQUEST";
    const method = (["REQUEST", "REPLY", "CANCEL", "PUBLISH"].includes(methodStr)
      ? methodStr
      : "REQUEST") as ParsedCalendarInvite["method"];

    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) return null;

    const event = new ICAL.Event(vevent);

    const uid = event.uid || `omnimail-invite-${Date.now()}`;
    const summary = event.summary || "(No Title)";
    const description = event.description || null;
    const location = event.location || null;

    // Detect video call link (Google Meet, Zoom, MS Teams, Webex)
    let meetingLink: string | null = null;
    let isMeetingLink = false;

    if (location) {
      const urlMatch = location.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        meetingLink = urlMatch[0];
        isMeetingLink = true;
      }
    }

    if (!meetingLink && description) {
      const meetMatch = description.match(
        /https?:\/\/(meet\.google\.com\/[a-z0-9-]+|[a-z0-9]+\.zoom\.us\/j\/[a-z0-9?=_&]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s]+)/i
      );
      if (meetMatch) {
        meetingLink = meetMatch[0];
        isMeetingLink = true;
      }
    }

    const startDate = event.startDate ? event.startDate.toJSDate().toISOString() : new Date().toISOString();
    const endDate = event.endDate
      ? event.endDate.toJSDate().toISOString()
      : new Date(new Date(startDate).getTime() + 3600000).toISOString();
    const isAllDay = Boolean(event.startDate && event.startDate.isDate);

    // Organizer extraction
    let organizer: ParsedCalendarInvite["organizer"] = null;
    const orgProp = vevent.getFirstProperty("organizer");
    if (orgProp) {
      const orgVal = String(orgProp.getFirstValue()).replace(/^mailto:/i, "").trim();
      const orgCn = String(orgProp.getParameter("cn") || orgVal.split("@")[0]);
      organizer = {
        name: orgCn,
        email: orgVal,
      };
    }

    // Attendees extraction
    const attendees: CalendarAttendee[] = [];
    const attendeeProps = vevent.getAllProperties("attendee");
    for (const attProp of attendeeProps) {
      const attVal = String(attProp.getFirstValue()).replace(/^mailto:/i, "").trim();
      const cn = String(attProp.getParameter("cn") || attVal.split("@")[0]);
      const partstatParam = attProp.getParameter("partstat");
      const partstatRaw = String(partstatParam || "NEEDS-ACTION").toUpperCase();
      const partstat = (["ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION"].includes(partstatRaw)
        ? partstatRaw
        : "NEEDS-ACTION") as CalendarAttendee["partstat"];
      const roleParam = attProp.getParameter("role");
      const role = roleParam ? String(roleParam) : undefined;

      attendees.push({
        name: cn,
        email: attVal,
        partstat,
        role,
      });
    }

    const statusProp = vevent.getFirstProperty("status");
    const statusVal = statusProp ? String(statusProp.getFirstValue()).toUpperCase() : "CONFIRMED";
    const status = (["CONFIRMED", "TENTATIVE", "CANCELLED"].includes(statusVal)
      ? statusVal
      : "CONFIRMED") as ParsedCalendarInvite["status"];

    const rrule = vevent.getFirstPropertyValue("rrule")?.toString() || null;

    return {
      uid,
      summary,
      description,
      location,
      isMeetingLink,
      meetingLink,
      startDate,
      endDate,
      isAllDay,
      organizer,
      attendees,
      method,
      rrule,
      rawIcs,
      status,
    };
  } catch (err) {
    console.error("Error parsing iCalendar raw text:", err);
    return null;
  }
}

/**
 * Checks if this event UID is already stored on any of the user's calendars, and retrieves its status
 */
export async function getExistingEventRsvp(
  userId: string,
  eventUid: string
): Promise<{ exists: boolean; status: "accepted" | "tentative" | "declined" | "needs-action"; eventId?: string }> {
  try {
    const existing = await prisma.calendarEvent.findFirst({
      where: {
        uid: eventUid,
        calendar: {
          account: {
            userId,
          },
        },
      },
      select: {
        id: true,
        summary: true,
      },
    });

    if (!existing) {
      return { exists: false, status: "needs-action" };
    }

    return { exists: true, status: "accepted", eventId: existing.id };
  } catch {
    return { exists: false, status: "needs-action" };
  }
}

/**
 * Generates an RFC 5546 iMIP iCalendar REPLY string
 */
export function buildRsvpIcs(params: {
  uid: string;
  summary: string;
  startDate: string;
  endDate: string;
  organizerEmail: string;
  userEmail: string;
  userName?: string;
  action: "accept" | "tentative" | "decline";
}): string {
  const {
    uid,
    summary,
    startDate,
    endDate,
    organizerEmail,
    userEmail,
    userName,
    action,
  } = params;

  const partstat =
    action === "accept"
      ? "ACCEPTED"
      : action === "tentative"
      ? "TENTATIVE"
      : "DECLINED";

  const status =
    action === "accept"
      ? "CONFIRMED"
      : action === "tentative"
      ? "TENTATIVE"
      : "CANCELLED";

  const toIcalDate = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

  const nowIcal = toIcalDate(new Date());
  const startIcal = toIcalDate(new Date(startDate));
  const endIcal = toIcalDate(new Date(endDate));
  const cn = userName ? `;CN="${userName.replace(/"/g, "")}"` : "";

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//AltixCode//OmniMail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    `DTSTAMP:${nowIcal}`,
    `DTSTART:${startIcal}`,
    `DTEND:${endIcal}`,
    `ORGANIZER:mailto:${organizerEmail}`,
    `ATTENDEE;PARTSTAT=${partstat}${cn}:mailto:${userEmail}`,
    `STATUS:${status}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
