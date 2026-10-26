import test from "node:test";
import assert from "node:assert/strict";
import {
  wallTimeToUTC,
  getWallClockInTimezone,
  getSchedulePresets,
  resolveEffectiveTimezone,
  formatScheduledDisplay,
} from "../src/lib/timezone";
import prisma from "../src/lib/db";
import scheduledEmailWorker from "../src/server/scheduled-worker";

test("wallTimeToUTC converts local wall-clock time in specific timezone accurately", () => {
  // New York is UTC-4 in summer (EDT) or UTC-5 in winter (EST)
  // Let's test a known EDT date: July 15, 2026 at 09:00:00
  const utcDate = wallTimeToUTC(2026, 7, 15, 9, 0, 0, "America/New_York");
  // 9:00 AM EDT is 13:00:00 UTC
  assert.equal(utcDate.toISOString(), "2026-07-15T13:00:00.000Z");

  // Berlin is UTC+2 in summer (CEST)
  // July 15, 2026 at 15:00:00 CEST is 13:00:00 UTC
  const berlinUtc = wallTimeToUTC(2026, 7, 15, 15, 0, 0, "Europe/Berlin");
  assert.equal(berlinUtc.toISOString(), "2026-07-15T13:00:00.000Z");
});

test("getWallClockInTimezone extracts correct components", () => {
  const date = new Date("2026-07-15T13:00:00.000Z");
  const nyWall = getWallClockInTimezone(date, "America/New_York");
  assert.equal(nyWall.year, 2026);
  assert.equal(nyWall.month, 7);
  assert.equal(nyWall.day, 15);
  assert.equal(nyWall.hour, 9);
  assert.equal(nyWall.minute, 0);

  const berlinWall = getWallClockInTimezone(date, "Europe/Berlin");
  assert.equal(berlinWall.hour, 15);
  assert.equal(berlinWall.minute, 0);
});

test("getSchedulePresets calculates tomorrow morning at 8:00 AM in target timezone", () => {
  const refDate = new Date("2026-10-26T14:00:00.000Z");
  const presets = getSchedulePresets(refDate, "America/New_York");

  assert.equal(presets.length, 3);
  assert.equal(presets[0].id, "tomorrow-morning");
  assert.equal(presets[1].id, "tomorrow-afternoon");
  assert.equal(presets[2].id, "monday-morning");

  // In New York, tomorrow morning is Oct 27 at 8:00 AM EDT (12:00 UTC)
  const tomorrowWall = getWallClockInTimezone(presets[0].date, "America/New_York");
  assert.equal(tomorrowWall.hour, 8);
  assert.equal(tomorrowWall.minute, 0);
  assert.equal(tomorrowWall.day, 27);
});

test("resolveEffectiveTimezone respects user manual timezone or falls back to detected", () => {
  const manualUser = {
    timezoneMode: "manual",
    timezone: "Asia/Tokyo",
  };
  assert.equal(resolveEffectiveTimezone(manualUser), "Asia/Tokyo");

  const autoUser = {
    timezoneMode: "automatic",
    timezone: "Asia/Tokyo",
  };
  const autoResolved = resolveEffectiveTimezone(autoUser);
  assert.ok(typeof autoResolved === "string" && autoResolved.length > 0);
});

test("formatScheduledDisplay formats date with time and timezone abbreviation", () => {
  const date = new Date("2026-10-27T12:00:00.000Z");
  const display = formatScheduledDisplay(date, "America/New_York");
  assert.ok(display.includes("8:00 AM"));
  assert.ok(display.includes("EDT") || display.includes("America/New_York"));
});

test("scheduledEmailWorker CRUD operations", async () => {
  // Ensure a test user and mail account exist
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "scheduler-test@example.com",
        name: "Scheduler Test User",
      },
    });
  }

  let account = await prisma.mailAccount.findFirst({
    where: { userId: user.id },
  });
  if (!account) {
    account = await prisma.mailAccount.create({
      data: {
        userId: user.id,
        label: "Test Account",
        emailAddress: "test@example.com",
        imapHost: "imap.example.com",
        imapUser: "test@example.com",
        imapPassEnc: "test",
        smtpHost: "smtp.example.com",
        smtpUser: "test@example.com",
        smtpPassEnc: "test",
      },
    });
  }

  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day in future
  const created = await scheduledEmailWorker.createScheduledEmail({
    userId: user.id,
    accountId: account.id,
    to: ["recipient@example.com"],
    subject: "Test Scheduled Email",
    bodyText: "This is scheduled for tomorrow",
    scheduledAt: futureDate,
    timezone: "Europe/Berlin",
    attachments: [
      {
        filename: "test.txt",
        contentType: "text/plain",
        content: Buffer.from("hello world").toString("base64"),
      },
    ],
  });

  assert.ok(created.id);
  assert.equal(created.subject, "Test Scheduled Email");
  assert.equal(created.status, "pending");

  // Query list
  const list = await scheduledEmailWorker.getScheduledMessagesForUser(user.id);
  const found = list.find((m) => m.scheduledId === created.id);
  assert.ok(found);
  assert.equal(found.isScheduled, true);
  assert.equal(found.hasAttachments, true);

  // Query detail
  const detail = await scheduledEmailWorker.getScheduledEmailDetail(created.id, user.id);
  assert.ok(detail);
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].filename, "test.txt");

  // Update
  const updatedFuture = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const updated = await scheduledEmailWorker.updateScheduledEmail(created.id, user.id, {
    subject: "Updated Scheduled Subject",
    scheduledAt: updatedFuture,
  });
  assert.equal(updated.subject, "Updated Scheduled Subject");

  // Delete / cancel
  const deleteResult = await scheduledEmailWorker.deleteScheduledEmail(created.id, user.id);
  assert.equal(deleteResult.success, true);

  const afterDelete = await scheduledEmailWorker.getScheduledEmailDetail(created.id, user.id);
  assert.equal(afterDelete, null);
});
