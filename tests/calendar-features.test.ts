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

test("buildRsvpIcs generates RFC 5546 compliant reply with SEQUENCE and PARTSTAT=ACCEPTED", () => {
  const { buildRsvpIcs, updateAttendeePartstatInIcs } = require("../src/lib/calendar-invite");

  const reply = buildRsvpIcs({
    uid: "event-google-999@google.com",
    summary: "Roadmap Review",
    startDate: "2026-10-25T10:00:00.000Z",
    endDate: "2026-10-25T11:00:00.000Z",
    organizerEmail: "organizer@google.com",
    userEmail: "atasmohammadi@gmail.com",
    userName: "Ata Mohammadi",
    action: "accept",
    sequence: 3,
  });

  assert.ok(reply.includes("METHOD:REPLY"), "Must have METHOD:REPLY");
  assert.ok(reply.includes("SEQUENCE:3"), "Must retain SEQUENCE from original invite");
  assert.ok(reply.includes("ATTENDEE;PARTSTAT=ACCEPTED;CN=\"Ata Mohammadi\""), "Must have PARTSTAT=ACCEPTED");
  assert.ok(reply.includes("mailto:atasmohammadi@gmail.com"), "Must have user email");
  assert.ok(reply.includes("ORGANIZER:mailto:organizer@google.com"), "Must have organizer email");

  // Test CalDAV attendee update in raw ICS
  const originalIcs = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:event-google-999@google.com",
    "SUMMARY:Roadmap Review",
    "ORGANIZER:mailto:organizer@google.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=\"Ata\":mailto:atasmohammadi@gmail.com",
    "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:other@example.com",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const updatedAccepted = updateAttendeePartstatInIcs(originalIcs, "atasmohammadi@gmail.com", "accept");
  const unfoldedAccepted = updatedAccepted.replace(/\r?\n[ \t]/g, "");
  assert.ok(unfoldedAccepted.includes("PARTSTAT=ACCEPTED"), "User attendee must be updated to PARTSTAT=ACCEPTED for CalDAV PUT");
  assert.ok(unfoldedAccepted.includes("other@example.com"), "Other attendee remains untouched");

  const updatedDeclined = updateAttendeePartstatInIcs(originalIcs, "atasmohammadi@gmail.com", "decline");
  const unfoldedDeclined = updatedDeclined.replace(/\r?\n[ \t]/g, "");
  assert.ok(unfoldedDeclined.includes("PARTSTAT=DECLINED"), "User attendee must be updated to PARTSTAT=DECLINED");
});
