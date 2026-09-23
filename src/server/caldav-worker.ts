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

      if (!account || !account.caldavUrl || !account.caldavUser || !account.caldavPassEnc) {
        return { success: false, eventCount: 0, error: "CalDAV not configured for this account" };
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
}

export const caldavWorker = new CaldavWorker();
export default caldavWorker;
