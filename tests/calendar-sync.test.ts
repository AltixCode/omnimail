import assert from "node:assert/strict";
import test from "node:test";
import { icalTimeToUTC, wallTimeToUTC } from "../src/lib/timezone";
import ICAL from "ical.js";

test("converts rescheduled 11:00 Cyprus time meeting to accurate UTC timestamp", () => {
  // Asia/Nicosia in October 2026 is EEST (UTC+3)
  const utcDate = wallTimeToUTC(2026, 10, 21, 11, 0, 0, "Asia/Nicosia");
  assert.equal(utcDate.toISOString(), "2026-10-21T08:00:00.000Z");
});

test("parses rescheduled VEVENT and extracts 11:00 Asia/Nicosia start date", () => {
  const icsText = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
DTSTART;TZID=Asia/Nicosia:20261021T110000
DTEND;TZID=Asia/Nicosia:20261021T113000
UID:cm6mc0ggtrtq0qrhjvele5lvm2_R20260930T110000@google.com
RECURRENCE-ID;TZID=Europe/Berlin:20261021T130000
SEQUENCE:2
STATUS:CONFIRMED
SUMMARY:Company Update
END:VEVENT
END:VCALENDAR`;

  const jcalData = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcalData);
  const vevent = comp.getFirstSubcomponent("vevent");
  assert.ok(vevent);
  const event = new ICAL.Event(vevent);

  const recurrenceId = vevent.getFirstPropertyValue("recurrence-id")?.toString();
  assert.ok(recurrenceId);
  const baseUid = event.uid;
  const uid = recurrenceId ? `${baseUid}#${recurrenceId}` : baseUid;
  assert.equal(
    uid,
    "cm6mc0ggtrtq0qrhjvele5lvm2_R20260930T110000@google.com#2026-10-21T13:00:00"
  );

  const dtstartProp = vevent.getFirstProperty("dtstart");
  const tzid = dtstartProp?.getParameter("tzid");
  assert.equal(tzid, "Asia/Nicosia");

  const { date: startDate, timezone } = icalTimeToUTC(event.startDate, tzid);
  assert.equal(timezone, "Asia/Nicosia");
  assert.equal(startDate.toISOString(), "2026-10-21T08:00:00.000Z");
});

test("indexes recurrence-id original date so master recurring iterator suppresses overridden instance", () => {
  const dbEvents = [
    {
      uid: "cm6mc0ggtrtq0qrhjvele5lvm2_R20260930T110000@google.com#2026-10-21T13:00:00",
      startDate: new Date("2026-10-21T08:00:00.000Z"),
    },
  ];

  const exceptionMap = new Set<string>();
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

  assert.ok(
    exceptionMap.has(
      "cm6mc0ggtrtq0qrhjvele5lvm2_R20260930T110000@google.com_2026-10-21"
    )
  );
});
