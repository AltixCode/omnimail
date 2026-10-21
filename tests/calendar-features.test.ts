import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchQuery, buildSearchQueryString } from "../src/lib/search-query";
import ICAL from "ical.js";

test("search query parser recognizes in:spam and in:junk", () => {
  const qSpam = parseSearchQuery("in:spam project");
  assert.equal(qSpam.inView, "spam");
  assert.deepEqual(qSpam.freeWords, ["project"]);

  const qJunk = parseSearchQuery("in:junk urgent");
  assert.equal(qJunk.inView, "spam");
  assert.deepEqual(qJunk.freeWords, ["urgent"]);

  const roundTrip = buildSearchQueryString({ inView: "spam", hasWords: "invoice" });
  assert.equal(roundTrip, "invoice in:spam");
});

test("parses RFC 5545 iCalendar content with attendees and meeting links", () => {
  const sampleIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OmniMail//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:test-meeting-12345@omnimail.app",
    "DTSTAMP:20261021T080000Z",
    "DTSTART:20261021T100000Z",
    "DTEND:20261021T110000Z",
    "SUMMARY:Quarterly Strategy Sync",
    "DESCRIPTION:Discussion on roadmap and goals.\\n\\nVideo Meeting: https://meet.google.com/abc-defg-hij",
    "LOCATION:https://meet.google.com/abc-defg-hij",
    "ORGANIZER;CN=\"Ata Mohammadi\":mailto:ata@example.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=\"Partner\":mailto:partner@external.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=\"Colleague\":mailto:colleague@company.com",
    "RRULE:FREQ=WEEKLY;BYDAY=WE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const jcal = ICAL.parse(sampleIcs);
  const comp = new ICAL.Component(jcal);
  const vevent = comp.getFirstSubcomponent("vevent");

  assert.ok(vevent, "VEVENT must be present");
  assert.equal(vevent.getFirstPropertyValue("uid"), "test-meeting-12345@omnimail.app");
  assert.equal(vevent.getFirstPropertyValue("summary"), "Quarterly Strategy Sync");
  assert.equal(vevent.getFirstPropertyValue("location"), "https://meet.google.com/abc-defg-hij");

  const attendees = vevent.getAllProperties("attendee").map((p) => p.getFirstValue());
  assert.equal(attendees.length, 2);
  assert.ok(attendees.includes("mailto:partner@external.com"));
  assert.ok(attendees.includes("mailto:colleague@company.com"));

  const rrule: any = vevent.getFirstPropertyValue("rrule");
  assert.equal(rrule?.freq, "WEEKLY");
});
