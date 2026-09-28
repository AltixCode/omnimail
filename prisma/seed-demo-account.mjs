// One-off seeding script for the App Store screenshot demo account
// (demo-mobile-shots@altixcode.com). Populates one cosmetic mail account,
// a handful of realistic-but-fictional messages, and a couple of
// calendar events so the mobile app's Inbox/Message/Calendar screens
// have something to show. Safe to re-run (idempotent upserts).
//
// Run inside the deployed container, where DATABASE_URL / APP_SECRET_KEY
// are already set:
//   node prisma/seed-demo-account.mjs

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const ALGORITHM = "aes-256-gcm";
function encrypt(text) {
  const key = crypto
    .createHash("sha256")
    .update(process.env.APP_SECRET_KEY || "omnimail-secret-encryption-key-2026")
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc}`;
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "demo-mobile-shots@altixcode.com" },
  });
  if (!user) {
    throw new Error("demo-mobile-shots@altixcode.com not found - create the account first");
  }

  const account = await prisma.mailAccount.upsert({
    where: { id: "demo-shots-account" },
    update: {},
    create: {
      id: "demo-shots-account",
      userId: user.id,
      label: "Personal",
      emailAddress: "jordan.rivera@example.com",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "jordan.rivera@example.com",
      imapPassEnc: encrypt("demo-screenshot-password"),
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "jordan.rivera@example.com",
      smtpPassEnc: encrypt("demo-screenshot-password"),
      syncActive: false,
      syncStatus: "idle",
      lastSyncAt: new Date(),
    },
  });

  const inbox = await prisma.folder.upsert({
    where: { accountId_path: { accountId: account.id, path: "INBOX" } },
    update: { unreadCount: 3, totalCount: 6 },
    create: {
      accountId: account.id,
      name: "INBOX",
      path: "INBOX",
      specialUse: "\\Inbox",
      unreadCount: 3,
      totalCount: 6,
    },
  });

  await prisma.folder.upsert({
    where: { accountId_path: { accountId: account.id, path: "Sent" } },
    update: {},
    create: {
      accountId: account.id,
      name: "Sent",
      path: "Sent",
      specialUse: "\\Sent",
      unreadCount: 0,
      totalCount: 0,
    },
  });

  const messages = [
    {
      id: "demo-shots-msg-1",
      uid: 1,
      messageId: "<demo-1@example.com>",
      subject: "Your itinerary for the Lisbon trip",
      fromAddress: "trips@wanderly.example.com",
      fromName: "Wanderly Travel",
      snippet: "Your flight and hotel confirmation for next week's trip to Lisbon is attached.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><p>Hi Jordan,</p><p>Your trip to <strong>Lisbon</strong> is confirmed. Here's a quick summary:</p><ul><li>Flight TP1234 - departs 09:40</li><li>Hotel Alfama Suites - 4 nights</li><li>Airport transfer booked</li></ul><p>Safe travels!</p></div>`,
      minsAgo: 20,
      isRead: false,
      isStarred: true,
      hasAttachments: true,
    },
    {
      id: "demo-shots-msg-2",
      uid: 2,
      messageId: "<demo-2@example.com>",
      subject: "Design review: new dashboard mockups",
      fromAddress: "priya@studioflux.example.com",
      fromName: "Priya Nandan",
      snippet: "Attached the latest mockups for the dashboard redesign, would love your thoughts before Thursday.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><p>Hey Jordan,</p><p>Attached the latest mockups for the dashboard redesign. Would love your thoughts before Thursday's review.</p><p>Thanks!<br/>Priya</p></div>`,
      minsAgo: 90,
      isRead: false,
      isStarred: false,
      hasAttachments: false,
    },
    {
      id: "demo-shots-msg-3",
      uid: 3,
      messageId: "<demo-3@example.com>",
      subject: "Your receipt from Northwind Coffee",
      fromAddress: "receipts@northwindcoffee.example.com",
      fromName: "Northwind Coffee",
      snippet: "Thanks for your order! Here is your digital receipt for today's purchase.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><p>Thanks for stopping by, Jordan!</p><p>1x Flat White - $4.50<br/>1x Almond Croissant - $3.75</p><p><strong>Total: $8.25</strong></p></div>`,
      minsAgo: 200,
      isRead: false,
      isStarred: false,
      hasAttachments: false,
    },
    {
      id: "demo-shots-msg-4",
      uid: 4,
      messageId: "<demo-4@example.com>",
      subject: "Weekend newsletter: what we're reading",
      fromAddress: "digest@readwell.example.com",
      fromName: "Readwell Weekly",
      snippet: "Five great long-reads to start your weekend, hand-picked by our editors.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><h2>This week's picks</h2><p>Five great long-reads to start your weekend, hand-picked by our editors.</p></div>`,
      minsAgo: 1400,
      isRead: true,
      isStarred: false,
      hasAttachments: false,
    },
    {
      id: "demo-shots-msg-5",
      uid: 5,
      messageId: "<demo-5@example.com>",
      subject: "Team sync notes - action items",
      fromAddress: "morgan@studioflux.example.com",
      fromName: "Morgan Lee",
      snippet: "Notes from today's sync are below, three action items assigned to you.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><p>Hi all,</p><p>Notes from today's sync are below. Three action items assigned to Jordan - see checklist.</p><ol><li>Finalize onboarding copy</li><li>Review analytics dashboard</li><li>Share Lisbon trip dates with the team</li></ol></div>`,
      minsAgo: 2600,
      isRead: true,
      isStarred: false,
      hasAttachments: false,
    },
    {
      id: "demo-shots-msg-6",
      uid: 6,
      messageId: "<demo-6@example.com>",
      subject: "Welcome to Northwind Fitness",
      fromAddress: "hello@northwindfitness.example.com",
      fromName: "Northwind Fitness",
      snippet: "Welcome aboard! Here's how to get started with your new membership.",
      bodyHtml: `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;"><p>Welcome aboard, Jordan!</p><p>Here's how to get started with your new membership, including class booking and locker setup.</p></div>`,
      minsAgo: 4000,
      isRead: true,
      isStarred: false,
      hasAttachments: false,
    },
  ];

  for (const m of messages) {
    await prisma.message.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        accountId: account.id,
        folderId: inbox.id,
        uid: m.uid,
        messageId: m.messageId,
        subject: m.subject,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        toAddresses: JSON.stringify(["jordan.rivera@example.com"]),
        date: new Date(Date.now() - m.minsAgo * 60 * 1000),
        snippet: m.snippet,
        bodyText: m.snippet,
        bodyHtml: m.bodyHtml,
        isRead: m.isRead,
        isStarred: m.isStarred,
        hasAttachments: m.hasAttachments,
      },
    });
  }

  const calendar = await prisma.calendar.upsert({
    where: { id: "demo-shots-calendar" },
    update: {},
    create: {
      id: "demo-shots-calendar",
      accountId: account.id,
      name: "Personal",
      color: "#3b82f6",
      caldavUrl: "",
    },
  });

  const todayEvent = new Date();
  todayEvent.setHours(todayEvent.getHours() + 3, 0, 0, 0);
  const todayEventEnd = new Date(todayEvent.getTime() + 45 * 60 * 1000);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 30, 0, 0);

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 6);
  nextWeek.setHours(0, 0, 0, 0);
  const nextWeekEnd = new Date(nextWeek);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 4);

  const events = [
    {
      uid: "demo-evt-design-review",
      summary: "Design review: dashboard mockups",
      description: "Walk through the new dashboard mockups with Priya and the team.",
      location: "Studio Flux, Room 2",
      startDate: todayEvent,
      endDate: todayEventEnd,
      isAllDay: false,
    },
    {
      uid: "demo-evt-team-sync",
      summary: "Team sync",
      description: "Weekly team sync and planning.",
      location: "Video call",
      startDate: tomorrow,
      endDate: tomorrowEnd,
      isAllDay: false,
    },
    {
      uid: "demo-evt-lisbon-trip",
      summary: "Trip to Lisbon",
      description: "Flight TP1234, Hotel Alfama Suites.",
      location: "Lisbon, Portugal",
      startDate: nextWeek,
      endDate: nextWeekEnd,
      isAllDay: true,
    },
  ];

  for (const e of events) {
    await prisma.calendarEvent.upsert({
      where: { calendarId_uid: { calendarId: calendar.id, uid: e.uid } },
      update: {},
      create: { calendarId: calendar.id, ...e },
    });
  }

  console.log("Demo screenshot account seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
