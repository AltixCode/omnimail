import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

const ALGORITHM = "aes-256-gcm";
const KEY = crypto.createHash("sha256").update(process.env.APP_SECRET_KEY || "omnimail-secret-encryption-key-2026").digest();

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc}`;
}

async function main() {
  console.log("Seeding OmniMail database...");

  // 1. Create Default User
  const user = await prisma.user.upsert({
    where: { email: "owner@omnimail.local" },
    update: {},
    create: {
      email: "owner@omnimail.local",
      name: "OmniMail Master",
    },
  });

  // 2. Account A: Work Fastmail
  const workAccount = await prisma.mailAccount.upsert({
    where: { id: "acc-work-fastmail" },
    update: {},
    create: {
      id: "acc-work-fastmail",
      userId: user.id,
      label: "Work Fastmail",
      emailAddress: "alex.turner@altixcode.com",
      imapHost: "imap.fastmail.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "alex.turner@altixcode.com",
      imapPassEnc: encrypt("sample-app-password-work"),
      smtpHost: "smtp.fastmail.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "alex.turner@altixcode.com",
      smtpPassEnc: encrypt("sample-app-password-work"),
      caldavUrl: "https://caldav.fastmail.com/dav/",
      caldavUser: "alex.turner@altixcode.com",
      caldavPassEnc: encrypt("sample-app-password-work"),
      syncActive: true,
      syncStatus: "idle",
      lastSyncAt: new Date(),
    },
  });

  // 3. Account B: Personal Gmail
  const personalAccount = await prisma.mailAccount.upsert({
    where: { id: "acc-personal-gmail" },
    update: {},
    create: {
      id: "acc-personal-gmail",
      userId: user.id,
      label: "Personal Gmail",
      emailAddress: "alex.personal@gmail.com",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "alex.personal@gmail.com",
      imapPassEnc: encrypt("sample-app-password-personal"),
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "alex.personal@gmail.com",
      smtpPassEnc: encrypt("sample-app-password-personal"),
      syncActive: true,
      syncStatus: "idle",
      lastSyncAt: new Date(),
    },
  });

  // 4. Folders for Work Account
  const workInbox = await prisma.folder.upsert({
    where: { accountId_path: { accountId: workAccount.id, path: "INBOX" } },
    update: { unreadCount: 2, totalCount: 4 },
    create: {
      accountId: workAccount.id,
      name: "INBOX",
      path: "INBOX",
      specialUse: "\\Inbox",
      unreadCount: 2,
      totalCount: 4,
    },
  });

  const workSent = await prisma.folder.upsert({
    where: { accountId_path: { accountId: workAccount.id, path: "Sent" } },
    update: { unreadCount: 0, totalCount: 1 },
    create: {
      accountId: workAccount.id,
      name: "Sent",
      path: "Sent",
      specialUse: "\\Sent",
      unreadCount: 0,
      totalCount: 1,
    },
  });

  // 5. Folders for Personal Account
  const personalInbox = await prisma.folder.upsert({
    where: { accountId_path: { accountId: personalAccount.id, path: "INBOX" } },
    update: { unreadCount: 1, totalCount: 2 },
    create: {
      accountId: personalAccount.id,
      name: "INBOX",
      path: "INBOX",
      specialUse: "\\Inbox",
      unreadCount: 1,
      totalCount: 2,
    },
  });

  // 6. Seed Messages for Work Account
  await prisma.message.upsert({
    where: { folderId_uid: { folderId: workInbox.id, uid: 101 } },
    update: {},
    create: {
      accountId: workAccount.id,
      folderId: workInbox.id,
      uid: 101,
      messageId: "<msg-q3-roadmap-2026@altixcode.com>",
      subject: "Q3 Architecture Review & Deployment Schedule",
      fromAddress: "sarah.lead@altixcode.com",
      fromName: "Sarah Connor (CTO)",
      toAddresses: JSON.stringify(["alex.turner@altixcode.com"]),
      date: new Date(Date.now() - 15 * 60 * 1000), // 15 mins ago
      snippet: "Hi Alex, please find attached the reviewed architecture diagram and Coolify Hetzner cluster setup notes. Let's sync tomorrow at 10:00 AM.",
      bodyText: "Hi Alex,\n\nPlease find attached the reviewed architecture diagram and Coolify Hetzner cluster setup notes.\n\nKey highlights:\n- IMAP IDLE real-time push latency is under 50ms.\n- Zero memory leaks across persistent socket workers.\n- High-efficiency PostgreSQL indexing.\n\nLet's sync tomorrow at 10:00 AM.\n\nBest regards,\nSarah",
      bodyHtml: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #1e293b;">
          <p>Hi Alex,</p>
          <p>Please find attached the reviewed architecture diagram and Coolify Hetzner cluster setup notes.</p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
            <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 14px;">Key Infrastructure Highlights:</h4>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155;">
              <li>IMAP IDLE real-time push latency is &lt; 50ms</li>
              <li>Zero memory leaks across persistent socket workers</li>
              <li>High-efficiency PostgreSQL GIN indexing on full-text search</li>
            </ul>
          </div>
          <p>Let's sync tomorrow at <strong>10:00 AM CET</strong>.</p>
          <p style="margin-top: 24px; color: #64748b; font-size: 13px;">Best regards,<br><strong>Sarah Connor</strong><br>VP Engineering</p>
        </div>
      `,
      isRead: false,
      isStarred: true,
      hasAttachments: true,
      attachments: {
        create: [
          {
            filename: "architecture-spec-2026.pdf",
            contentType: "application/pdf",
            size: 245000,
            dataBase64: Buffer.from("PDF sample file content").toString("base64"),
          },
        ],
      },
    },
  });

  await prisma.message.upsert({
    where: { folderId_uid: { folderId: workInbox.id, uid: 102 } },
    update: {},
    create: {
      accountId: workAccount.id,
      folderId: workInbox.id,
      uid: 102,
      messageId: "<msg-security-alert@cloudflare.com>",
      subject: "Cloudflare: Zero-Trust Tunnel Status Active",
      fromAddress: "notifications@cloudflare.com",
      fromName: "Cloudflare Gateway",
      toAddresses: JSON.stringify(["alex.turner@altixcode.com"]),
      date: new Date(Date.now() - 3 * 3600 * 1000), // 3 hours ago
      snippet: "Your Hetzner proxy edge routing has completed TLS handshake verification. Edge certificates are auto-renewing.",
      bodyText: "Your Hetzner proxy edge routing has completed TLS handshake verification. Edge certificates are auto-renewing.",
      bodyHtml: `<p>Your Hetzner proxy edge routing has completed TLS handshake verification. Edge certificates are auto-renewing.</p>`,
      isRead: false,
      isStarred: false,
      hasAttachments: false,
    },
  });

  await prisma.message.upsert({
    where: { folderId_uid: { folderId: workInbox.id, uid: 103 } },
    update: {},
    create: {
      accountId: workAccount.id,
      folderId: workInbox.id,
      uid: 103,
      messageId: "<msg-newsletter-digest@pragmatic.dev>",
      subject: "Weekly Engineering Digest: Real-time SSE vs WebSockets in 2026",
      fromAddress: "digest@pragmatic.dev",
      fromName: "The Pragmatic Engineer",
      toAddresses: JSON.stringify(["alex.turner@altixcode.com"]),
      date: new Date(Date.now() - 24 * 3600 * 1000), // Yesterday
      snippet: "In this issue, we compare HTTP/2 Server-Sent Events with persistent WebSockets for low-overhead email clients.",
      bodyText: "In this issue, we compare HTTP/2 Server-Sent Events with persistent WebSockets for low-overhead email clients.",
      bodyHtml: `
        <div style="font-family: sans-serif; color: #1e293b;">
          <h2>SSE vs WebSockets: The 2026 Verdict</h2>
          <p>For unidirectional real-time event streaming such as incoming email alerts and folder counters, Server-Sent Events over HTTP/2 are superior: zero connection upgrade overhead, built-in reconnection protocols, and seamless compatibility with reverse proxies.</p>
        </div>
      `,
      isRead: true,
      isStarred: false,
      hasAttachments: false,
    },
  });

  // 7. Seed Message for Personal Account
  await prisma.message.upsert({
    where: { folderId_uid: { folderId: personalInbox.id, uid: 201 } },
    update: {},
    create: {
      accountId: personalAccount.id,
      folderId: personalInbox.id,
      uid: 201,
      messageId: "<msg-github-sponsor@github.com>",
      subject: "GitHub: New Star on your OmniMail repository",
      fromAddress: "notifications@github.com",
      fromName: "GitHub",
      toAddresses: JSON.stringify(["alex.personal@gmail.com"]),
      date: new Date(Date.now() - 45 * 60 * 1000),
      snippet: "A developer just starred your repository AltixCode/omnimail. Keep up the awesome work!",
      bodyText: "A developer just starred your repository AltixCode/omnimail. Keep up the awesome work!",
      bodyHtml: `<p>A developer just starred your repository <strong>AltixCode/omnimail</strong>. Keep up the awesome work!</p>`,
      isRead: false,
      isStarred: true,
      hasAttachments: false,
    },
  });

  // 8. Seed Calendar & Events
  const workCal = await prisma.calendar.upsert({
    where: { id: "cal-work-primary" },
    update: {},
    create: {
      id: "cal-work-primary",
      accountId: workAccount.id,
      name: "Work Calendar",
      color: "#2563eb",
      caldavUrl: "https://caldav.fastmail.com/dav/calendars/work",
    },
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 0, 0, 0);

  await prisma.calendarEvent.upsert({
    where: {
      calendarId_uid: {
        calendarId: workCal.id,
        uid: "evt-eng-sync-2026",
      },
    },
    update: {},
    create: {
      calendarId: workCal.id,
      uid: "evt-eng-sync-2026",
      summary: "Engineering Sync & Coolify Deployment",
      description: "Review Hetzner Coolify production readiness, verify IMAP IDLE daemon, and test browser notifications.",
      location: "https://meet.altixcode.com/sync",
      startDate: tomorrow,
      endDate: tomorrowEnd,
      isAllDay: false,
    },
  });

  console.log("OmniMail database successfully seeded!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
