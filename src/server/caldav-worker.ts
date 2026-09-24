import { createDAVClient } from "tsdav";
import ICAL from "ical.js";
import prisma from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import eventBus from "./event-bus";

export class CaldavWorker {
  /**
   * Syncs calendars and events for an account with CalDAV configured
   */
  async syncAccount(accountId: string): Promise<{ success: boolean; eventCount: number; error?: string }> {
    try {
      const account = await prisma.mailAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        return { success: false, eventCount: 0, error: "Account not found" };
      }

      const isGoogle =
        account.emailAddress.toLowerCase().endsWith("@gmail.com") ||
        account.emailAddress.toLowerCase().endsWith("@googlemail.com") ||
        (Boolean(account.imapHost) && account.imapHost!.toLowerCase().includes("google")) ||
        (Boolean(account.caldavUrl) && account.caldavUrl!.toLowerCase().includes("google.com"));

      if (isGoogle) {
        return await this.syncGoogleDirectCalDav(account);
      }

      // Auto-detect Purelymail and fix invalid hostnames (mail.purelymail.com -> purelymail.com/dav/)
      const isPurelymail =
        account.emailAddress.toLowerCase().endsWith("@purelymail.com") ||
        (Boolean(account.imapHost) && account.imapHost!.toLowerCase().includes("purelymail"));

      let serverUrl = account.caldavUrl ? account.caldavUrl.trim() : "";
      if (serverUrl.includes("mail.purelymail.com")) {
        serverUrl = "https://purelymail.com/dav/";
        await prisma.mailAccount.update({
          where: { id: account.id },
          data: { caldavUrl: serverUrl },
        }).catch(() => {});
      } else if (!serverUrl && isPurelymail) {
        serverUrl = "https://purelymail.com/dav/";
        await prisma.mailAccount.update({
          where: { id: account.id },
          data: { caldavUrl: serverUrl },
        }).catch(() => {});
      }

      if (!serverUrl) {
        return { success: false, eventCount: 0, error: "Calendar sync not configured for this account" };
      }

      const normalizedUrl = serverUrl.replace(/^webcal:\/\//i, "https://");
      const isIcsFeed =
        normalizedUrl.endsWith(".ics") ||
        normalizedUrl.includes("/basic.ics") ||
        normalizedUrl.includes(".ics?") ||
        normalizedUrl.includes("calendar.google.com/calendar/ical/");

      if (isIcsFeed) {
        return await this.syncIcsFeed(account, normalizedUrl);
      }

      const calUser = account.caldavUser || account.imapUser || account.emailAddress;
      const calPassEnc = account.caldavPassEnc || account.imapPassEnc;

      if (!calUser || !calPassEnc) {
        return { success: false, eventCount: 0, error: "CalDAV credentials not configured for this account" };
      }

      const password = decryptSecret(calPassEnc);

      const client = await createDAVClient({
        serverUrl: normalizedUrl,
        credentials: {
          username: calUser,
          password: password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      // 1. Fetch Calendars
      const remoteCalendars = await client.fetchCalendars();
      let totalSyncedEvents = 0;

      for (const remoteCal of remoteCalendars) {
        const rawName = typeof remoteCal.displayName === "string" ? remoteCal.displayName.trim() : "";
        const calendarName =
          rawName && rawName.toLowerCase() !== "default"
            ? rawName
            : (account.label || account.emailAddress);
        const calendarUrl = remoteCal.url;
        const color = (remoteCal as any).calendarColor || "#3b82f6";

        let dbCalendar = await prisma.calendar.findFirst({
          where: { accountId: account.id, caldavUrl: calendarUrl },
        });

        if (!dbCalendar) {
          // Check if an existing placeholder/default calendar for this account exists
          dbCalendar = await prisma.calendar.findFirst({
            where: { accountId: account.id, caldavUrl: "" },
          });
        }

        if (dbCalendar) {
          dbCalendar = await prisma.calendar.update({
            where: { id: dbCalendar.id },
            data: { name: calendarName, color, caldavUrl: calendarUrl },
          });
        } else {
          dbCalendar = await prisma.calendar.create({
            data: {
              accountId: account.id,
              name: calendarName,
              color,
              caldavUrl: calendarUrl,
            },
          });
        }

        // 2. Fetch events in window: -60 days to +365 days
        const now = new Date();
        const timeRange = {
          start: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        };

        const calendarObjects = await client.fetchCalendarObjects({
          calendar: remoteCal,
          timeRange,
        });

        for (const calObj of calendarObjects) {
          if (!calObj.data) continue;

          try {
            const jcalData = ICAL.parse(calObj.data);
            const comp = new ICAL.Component(jcalData);
            const vevents = comp.getAllSubcomponents("vevent");

            for (const vevent of vevents) {
              const event = new ICAL.Event(vevent);
              const uid = event.uid || calObj.url;
              const summary = event.summary || "(No Title)";
              const description = event.description || null;
              const location = event.location || null;
              const startDate = event.startDate ? event.startDate.toJSDate() : new Date();
              const endDate = event.endDate ? event.endDate.toJSDate() : new Date(startDate.getTime() + 3600000);
              const isAllDay = Boolean(event.startDate && event.startDate.isDate);
              const rrule = vevent.getFirstPropertyValue("rrule")?.toString() || null;

              await prisma.calendarEvent.upsert({
                where: {
                  calendarId_uid: {
                    calendarId: dbCalendar.id,
                    uid,
                  },
                },
                update: {
                  summary,
                  description,
                  location,
                  startDate,
                  endDate,
                  isAllDay,
                  rrule,
                  etag: calObj.etag || null,
                  rawIcs: calObj.data,
                },
                create: {
                  calendarId: dbCalendar.id,
                  uid,
                  summary,
                  description,
                  location,
                  startDate,
                  endDate,
                  isAllDay,
                  rrule,
                  etag: calObj.etag || null,
                  rawIcs: calObj.data,
                },
              });

              totalSyncedEvents++;
            }
          } catch (parseErr) {
            console.error("Error parsing ICS object:", parseErr);
          }
        }
      }

      eventBus.broadcast("calendar-updated", { accountId, count: totalSyncedEvents });
      return { success: true, eventCount: totalSyncedEvents };
    } catch (err: any) {
      console.error(`CalDAV sync error for account ${accountId}:`, err);
      return { success: false, eventCount: 0, error: err?.message || String(err) };
    }
  }

  /**
   * Syncs calendar events from an iCal / ICS feed URL (such as Google Calendar Secret Address or webcal subscription)
   */
  async syncIcsFeed(account: any, icsUrl: string): Promise<{ success: boolean; eventCount: number; error?: string }> {
    try {
      const res = await fetch(icsUrl, {
        headers: {
          "User-Agent": "OmniMail/1.0 (CalDAV/iCal Sync)",
          "Accept": "text/calendar, application/calendar+xml, text/plain, */*",
        },
      });

      if (!res.ok) {
        return {
          success: false,
          eventCount: 0,
          error: `Failed to fetch calendar feed: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const icsData = await res.text();
      const jcalData = ICAL.parse(icsData);
      const comp = new ICAL.Component(jcalData);

      const calNameProp = comp.getFirstProperty("x-wr-calname");
      const calendarName =
        (calNameProp ? String(calNameProp.getFirstValue()) : null) ||
        `${account.label || account.emailAddress} Calendar`;

      let dbCalendar = await prisma.calendar.findFirst({
        where: { accountId: account.id, caldavUrl: account.caldavUrl },
      });

      if (!dbCalendar) {
        dbCalendar = await prisma.calendar.create({
          data: {
            accountId: account.id,
            name: calendarName,
            color: "#3b82f6",
            caldavUrl: account.caldavUrl,
          },
        });
      } else {
        await prisma.calendar.update({
          where: { id: dbCalendar.id },
          data: { name: calendarName },
        });
      }

      const vevents = comp.getAllSubcomponents("vevent");
      let totalSyncedEvents = 0;

      for (const vevent of vevents) {
        try {
          const event = new ICAL.Event(vevent);
          const uid = event.uid || `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const summary = event.summary || "(No Title)";
          const description = event.description || null;
          const location = event.location || null;
          const startDate = event.startDate ? event.startDate.toJSDate() : new Date();
          const endDate = event.endDate ? event.endDate.toJSDate() : new Date(startDate.getTime() + 3600000);
          const isAllDay = Boolean(event.startDate && event.startDate.isDate);
          const rrule = vevent.getFirstPropertyValue("rrule")?.toString() || null;

          await prisma.calendarEvent.upsert({
            where: {
              calendarId_uid: {
                calendarId: dbCalendar.id,
                uid,
              },
            },
            update: {
              summary,
              description,
              location,
              startDate,
              endDate,
              isAllDay,
              rrule,
              rawIcs: vevent.toString(),
            },
            create: {
              calendarId: dbCalendar.id,
              uid,
              summary,
              description,
              location,
              startDate,
              endDate,
              isAllDay,
              rrule,
              rawIcs: vevent.toString(),
            },
          });
          totalSyncedEvents++;
        } catch (itemErr) {
          console.error("Error parsing vevent in ICS feed:", itemErr);
        }
      }

      eventBus.broadcast("calendar-updated", { accountId: account.id, count: totalSyncedEvents });
      return { success: true, eventCount: totalSyncedEvents };
    } catch (err: any) {
      console.error(`iCal feed sync error for account ${account.id}:`, err);
      return { success: false, eventCount: 0, error: err?.message || String(err) };
    }
  }

  /**
   * Directly syncs Google Calendar via CalDAV REPORT query using Basic Auth (App Password)
   */
  async syncGoogleDirectCalDav(
    account: any,
    endpointUrl?: string,
    calUser?: string,
    calPass?: string
  ): Promise<{ success: boolean; eventCount: number; error?: string }> {
    try {
      const username = calUser || account.caldavUser || account.imapUser || account.emailAddress;
      const rawEnc = calPass || account.caldavPassEnc || account.imapPassEnc;
      if (!rawEnc) {
        return { success: false, eventCount: 0, error: "No password available for Google Calendar sync" };
      }
      const password = calPass ? rawEnc : decryptSecret(rawEnc);
      const url =
        endpointUrl ||
        account.caldavUrl ||
        `https://www.google.com/calendar/dav/${encodeURIComponent(username)}/events/`;

      const auth = Buffer.from(`${username}:${password}`).toString("base64");

      // CalDAV REPORT query requesting all VEVENT objects with their properties & raw ics data
      const queryXml = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

      const res = await fetch(url, {
        method: "REPORT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/xml; charset=utf-8",
          Depth: "1",
        },
        body: queryXml,
      });

      if (!res.ok) {
        return {
          success: false,
          eventCount: 0,
          error: `Google CalDAV REPORT failed: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const text = await res.text();

      // Find or create local Calendar representation
      const calendarName = `${account.label || account.emailAddress} (Google)`;
      let dbCalendar = await prisma.calendar.findFirst({
        where: { accountId: account.id, caldavUrl: url },
      });

      if (!dbCalendar) {
        dbCalendar = await prisma.calendar.create({
          data: {
            accountId: account.id,
            name: calendarName,
            color: "#4285f4",
            caldavUrl: url,
          },
        });
      }

      // Extract all calendar-data chunks
      const regex = /<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/gi;
      let match;
      let totalSyncedEvents = 0;

      const unescapeXml = (str: string) =>
        str
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

      while ((match = regex.exec(text)) !== null) {
        const rawIcs = unescapeXml(match[1].trim());
        try {
          const jcalData = ICAL.parse(rawIcs);
          const comp = new ICAL.Component(jcalData);
          const vevents = comp.getAllSubcomponents("vevent");

          for (const vevent of vevents) {
            const event = new ICAL.Event(vevent);
            const uid = event.uid || `google-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const summary = event.summary || "(No Title)";
            const description = event.description || null;
            const location = event.location || null;
            const startDate = event.startDate ? event.startDate.toJSDate() : new Date();
            const endDate = event.endDate ? event.endDate.toJSDate() : new Date(startDate.getTime() + 3600000);
            const isAllDay = Boolean(event.startDate && event.startDate.isDate);
            const rrule = vevent.getFirstPropertyValue("rrule")?.toString() || null;

            await prisma.calendarEvent.upsert({
              where: {
                calendarId_uid: {
                  calendarId: dbCalendar.id,
                  uid,
                },
              },
              update: {
                summary,
                description,
                location,
                startDate,
                endDate,
                isAllDay,
                rrule,
                rawIcs: vevent.toString(),
              },
              create: {
                calendarId: dbCalendar.id,
                uid,
                summary,
                description,
                location,
                startDate,
                endDate,
                isAllDay,
                rrule,
                rawIcs: vevent.toString(),
              },
            });

            totalSyncedEvents++;
          }
        } catch (itemErr) {
          // Skip invalid single calendar entry
        }
      }

      eventBus.broadcast("calendar-updated", { accountId: account.id, count: totalSyncedEvents });
      return { success: true, eventCount: totalSyncedEvents };
    } catch (err: any) {
      console.error(`Google CalDAV direct sync error:`, err);
      return { success: false, eventCount: 0, error: err?.message || String(err) };
    }
  }

  /**
   * Pushes a new or updated event to remote CalDAV server if calendar has caldavUrl
   */
  async pushEventToRemote(
    calendarId: string,
    event: {
      uid: string;
      summary: string;
      description?: string | null;
      location?: string | null;
      startDate: Date;
      endDate: Date;
      isAllDay?: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const calendar = await prisma.calendar.findUnique({
        where: { id: calendarId },
        include: { account: true },
      });
      if (!calendar || !calendar.caldavUrl) {
        return { success: true }; // Local-only calendar
      }

      const account = calendar.account;
      const isGoogle =
        account.emailAddress.toLowerCase().endsWith("@gmail.com") ||
        account.emailAddress.toLowerCase().endsWith("@googlemail.com") ||
        (Boolean(account.imapHost) && account.imapHost!.toLowerCase().includes("google")) ||
        (Boolean(calendar.caldavUrl) && calendar.caldavUrl.toLowerCase().includes("google.com"));

      const username = account.caldavUser || account.imapUser || account.emailAddress;
      const passEnc = account.caldavPassEnc || account.imapPassEnc;
      if (!username || !passEnc) {
        return { success: false, error: "Missing CalDAV credentials" };
      }
      const password = decryptSecret(passEnc);
      const auth = Buffer.from(`${username}:${password}`).toString("base64");

      const formatIcalDate = (d: Date, allDay?: boolean) => {
        if (allDay) {
          return d.toISOString().slice(0, 10).replace(/-/g, "");
        }
        return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      };

      const dtStamp = formatIcalDate(new Date());
      const dtStart = formatIcalDate(new Date(event.startDate), event.isAllDay);
      const dtEnd = formatIcalDate(new Date(event.endDate), event.isAllDay);

      const dtStartLine = event.isAllDay
        ? `DTSTART;VALUE=DATE:${dtStart}`
        : `DTSTART:${dtStart}`;
      const dtEndLine = event.isAllDay
        ? `DTEND;VALUE=DATE:${dtEnd}`
        : `DTEND:${dtEnd}`;

      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//OmniMail//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        `UID:${event.uid}`,
        `DTSTAMP:${dtStamp}`,
        dtStartLine,
        dtEndLine,
        `SUMMARY:${event.summary.replace(/[\r\n]+/g, " ")}`,
      ];

      if (event.description) {
        lines.push(`DESCRIPTION:${event.description.replace(/\r?\n/g, "\\n")}`);
      }
      if (event.location) {
        lines.push(`LOCATION:${event.location.replace(/[\r\n]+/g, " ")}`);
      }

      lines.push("END:VEVENT", "END:VCALENDAR");
      const icsData = lines.join("\r\n");

      let baseCalUrl = calendar.caldavUrl;
      if (!baseCalUrl.endsWith("/")) baseCalUrl += "/";
      const targetUrl = `${baseCalUrl}${encodeURIComponent(event.uid)}.ics`;

      const res = await fetch(targetUrl, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "text/calendar; charset=utf-8",
        },
        body: icsData,
      });

      if (!res.ok && res.status !== 201 && res.status !== 204) {
        console.warn(`Remote CalDAV PUT warning (${res.status}):`, await res.text().catch(() => ""));
        return { success: false, error: `Remote CalDAV returned HTTP ${res.status}` };
      }

      return { success: true };
    } catch (err: any) {
      console.error("Error pushing event to remote CalDAV:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Deletes an event from remote CalDAV server if calendar has caldavUrl
   */
  async deleteRemoteEvent(calendarId: string, uid: string): Promise<{ success: boolean; error?: string }> {
    try {
      const calendar = await prisma.calendar.findUnique({
        where: { id: calendarId },
        include: { account: true },
      });
      if (!calendar || !calendar.caldavUrl) {
        return { success: true }; // Local-only
      }

      const account = calendar.account;
      const username = account.caldavUser || account.imapUser || account.emailAddress;
      const passEnc = account.caldavPassEnc || account.imapPassEnc;
      if (!username || !passEnc) {
        return { success: false, error: "Missing CalDAV credentials" };
      }
      const password = decryptSecret(passEnc);
      const auth = Buffer.from(`${username}:${password}`).toString("base64");

      let baseCalUrl = calendar.caldavUrl;
      if (!baseCalUrl.endsWith("/")) baseCalUrl += "/";
      const targetUrl = `${baseCalUrl}${encodeURIComponent(uid)}.ics`;

      const res = await fetch(targetUrl, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (!res.ok && res.status !== 204 && res.status !== 404) {
        return { success: false, error: `Remote CalDAV DELETE returned HTTP ${res.status}` };
      }

      return { success: true };
    } catch (err: any) {
      console.error("Error deleting remote CalDAV event:", err);
      return { success: false, error: err.message };
    }
  }
}

export const caldavWorker = new CaldavWorker();
export default caldavWorker;
