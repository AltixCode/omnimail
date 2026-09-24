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

      if (!account.caldavUrl) {
        return { success: false, eventCount: 0, error: "Calendar sync not configured for this account" };
      }

      const rawUrl = account.caldavUrl.trim();
      const normalizedUrl = rawUrl.replace(/^webcal:\/\//i, "https://");
      const isIcsFeed =
        normalizedUrl.endsWith(".ics") ||
        normalizedUrl.includes("/basic.ics") ||
        normalizedUrl.includes(".ics?") ||
        normalizedUrl.includes("calendar.google.com/calendar/ical/");

      if (isIcsFeed) {
        return await this.syncIcsFeed(account, normalizedUrl);
      }

      if (!account.caldavUser || !account.caldavPassEnc) {
        return { success: false, eventCount: 0, error: "CalDAV credentials not configured for this account" };
      }

      const password = decryptSecret(account.caldavPassEnc);

      const client = await createDAVClient({
        serverUrl: account.caldavUrl,
        credentials: {
          username: account.caldavUser,
          password: password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      // 1. Fetch Calendars
      const remoteCalendars = await client.fetchCalendars();
      let totalSyncedEvents = 0;

      for (const remoteCal of remoteCalendars) {
        const calendarName =
          typeof remoteCal.displayName === "string"
            ? remoteCal.displayName
            : "Personal Calendar";
        const calendarUrl = remoteCal.url;
        const color = (remoteCal as any).calendarColor || "#3b82f6";

        const dbCalendar = await prisma.calendar.upsert({
          where: {
            id: remoteCal.url, // fallback or search by account and url
          },
          update: {
            name: calendarName,
            color,
          },
          create: {
            id: `${account.id}-${Buffer.from(calendarUrl).toString("base64").slice(0, 20)}`,
            accountId: account.id,
            name: calendarName,
            color,
            caldavUrl: calendarUrl,
          },
        }).catch(async () => {
          // If upsert by ID fails, find first by accountId and caldavUrl
          const existing = await prisma.calendar.findFirst({
            where: { accountId: account.id, caldavUrl: calendarUrl },
          });
          if (existing) {
            return prisma.calendar.update({
              where: { id: existing.id },
              data: { name: calendarName, color },
            });
          }
          return prisma.calendar.create({
            data: {
              accountId: account.id,
              name: calendarName,
              color,
              caldavUrl: calendarUrl,
            },
          });
        });

        // 2. Fetch events in window: -30 days to +365 days
        const now = new Date();
        const timeRange = {
          start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
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
}

export const caldavWorker = new CaldavWorker();
export default caldavWorker;
