<div align="center">

# 📬 OmniMail
### Unified Multi-Account Webmail & CalDAV Client

**A modern, lightweight, privacy-first open-source webmail and calendar aggregator with persistent IMAP IDLE push streaming, sandboxed email rendering, Gmail-grade search, and full CalDAV calendar synchronization.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B%20%7C%20v22%2B-brightgreen.svg)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16%20App%20Router-black.svg)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B%20%7C%2018-blue.svg)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com)

<br />

<img src="docs/screenshots/inbox.png" alt="OmniMail Unified Multi-Account Inbox" width="100%" style="border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);" />

</div>

---

## 🌟 Key Highlights

- ⚡ **Zero-Refresh Real-Time Push Streaming**: Built on Server-Sent Events (SSE) and persistent IMAP `IDLE` worker loops (`imapflow`). When an email arrives, your browser receives the update instantly with zero page reloads.
- 🔄 **Bi-Directional Read/Starred Remote Flag Sync**: Fully synchronized flag states between OmniMail and external clients (Apple Mail, Gmail Web, Thunderbird). Reading, starring, or deleting an email in another client instantly updates OmniMail in real-time via live IMAP IDLE flag updates and search reconciliation.
- ⚠️ **Intelligent Calendar Conflict Detection & Cross-Calendar Schedule Preview**: When viewing an email with a calendar invite, OmniMail automatically queries all connected calendars for that date and time, prominently warns you of direct schedule overlaps, and displays an embedded day agenda showing where the new meeting slots into your day.
- 📅 **Universal CalDAV & Multi-Calendar Hub**: Native two-way calendar sync for **12 popular providers**: Google Calendar, Apple iCloud, Microsoft Outlook (ICS feed), Purelymail, Fastmail, Yahoo / AOL, Zoho, Mailbox.org, Posteo, GMX, Web.de, and Nextcloud. Includes Month, Week, Day, and Agenda views with meeting reminders and one-click join links (Google Meet, Zoom, Teams).
- ✉️ **Gmail-Style Interactive Calendar Invites**: Incoming `.ics` meeting requests are detected and rendered with an interactive action bar. Accept, decline, or mark tentative with automatic insertion and synchronization into your active calendar.
- 🔍 **Advanced Gmail-Grade Search Engine**: Lightning-fast search with support for operators (`from:`, `to:`, `subject:`, `has:attachment`, `has:invite`, `larger:5M`, `older_than:7d`, term negation `-word`) plus a dedicated visual filter modal.
- ✍️ **Resizable Rich Composer with Markdown & HTML Paste**: Floating 80% viewport composer with interactive mouse resizing, minimize/maximize controls, and instant clipboard conversion of raw HTML and Markdown into styled elements.
- 🛡️ **Strict Email Sandboxing & Privacy Shield**: HTML emails are sanitized with DOMPurify and rendered strictly inside sandboxed `<iframe>` wrappers (`sandbox="allow-popups allow-popups-to-escape-sandbox"`). Remote tracking pixels and external images are blocked by default and safely proxied via an on-device gateway.
- 🔔 **Meeting Alerts & Audio Chimes**: Web Audio API synthesized chimes and HTML5 browser notifications for both incoming emails and calendar event reminders (10–30 minutes before start time).
- 🗄️ **Multi-Account Aggregation & Folder Separation**: Connect unlimited mail and calendar accounts. Browse inboxes separately or view unified aggregation across all accounts with unread counters, keeping standard mail folders cleanly separated from custom user labels.
- 🔄 **Resilient Batch Operations Queue**: Execute batch actions (archive, trash, star, mark read/unread) seamlessly with optimistic UI and persistent background queueing that survives page reloads without looping.
- 🔐 **Bank-Grade Credential Vault**: All IMAP, SMTP, and CalDAV passwords are encrypted at rest with AES-256-GCM authenticated cipher. Master passwords are protected via `scrypt` hashing.
- 🪶 **Ultra-Low Memory Footprint**: Runs in a minimal Alpine/Debian container using less than 150MB of idle RAM.

---

## 📸 Visual Tour

### 1. Integrated CalDAV Calendar & Meeting Hub
Schedule meetings, toggle account calendars, view recurrence rules, and receive meeting notifications with one-click video conference links.

<img src="docs/screenshots/calendar.png" alt="OmniMail Integrated Calendar & CalDAV" width="100%" style="border-radius: 10px; margin-bottom: 24px;" />

---

### 2. 12 Popular Email & CalDAV Provider Presets
Add any account in seconds. Simply type your email address (e.g. `@icloud.com`, `@yahoo.com`, `@purelymail.com`) and OmniMail auto-detects ports, server hostnames, and CalDAV endpoints.

<img src="docs/screenshots/account-providers.png" alt="12 Popular Provider Presets" width="100%" style="border-radius: 10px; margin-bottom: 24px;" />

---

### 3. Advanced Search & Query Filters
Search across all inboxes with Gmail-compatible syntax or open the visual filter modal to filter by date ranges, attachment sizes, read/starred status, and invitations.

<img src="docs/screenshots/advanced-search.png" alt="Advanced Search Modal" width="100%" style="border-radius: 10px; margin-bottom: 24px;" />

---

### 4. Floating Resizable Composer with HTML & Markdown Support
Drag to resize, minimize to the dock, format with rich TipTap tools, and paste raw HTML or Markdown with automatic formatting.

<img src="docs/screenshots/composer.png" alt="Floating TipTap Composer" width="100%" style="border-radius: 10px; margin-bottom: 24px;" />

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend (SPA)                         │
│  shadcn/ui Mail Split-Panes  │  Schedule-X Calendar  │  Tiptap Editor  │
│  Invite Action Bar           │  Advanced Search Bar  │  Resizable Modal│
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ SSE / REST / Streaming
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Node.js Core Backend Services                       │
│                                                                        │
│   ┌─────────────────────┐  ┌───────────────────┐  ┌────────────────┐   │
│   │ Account Vault       │  │ IMAP Worker Pool  │  │ CalDAV Worker  │   │
│   │ AES-256-GCM Secrets │  │ (imapflow + IDLE) │  │ (tsdav+ical.js)│   │
│   └─────────────────────┘  └─────────┬─────────┘  └───────┬────────┘   │
│                                      │                    │            │
│   ┌──────────────────────────────────▼────────────────────▼────────┐   │
│   │              PostgreSQL Database (Prisma ORM)                  │   │
│   │   [Accounts]  [Folders]  [Messages]  [Calendars]  [Events]     │   │
│   │   [Attachments: Base64 cache & binary stream]                  │   │
│   └──────────────────────────────────┬─────────────────────────────┘   │
│                                      │                                 │
│   ┌──────────────────────────────────▼─────────────────────────────┐   │
│   │ Outbound SMTP Dispatcher (nodemailer + attachments)            │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🗓️ Supported Calendar & CalDAV Providers

OmniMail includes native auto-detection and synchronization for all major email and calendar services:

| Provider | Calendar Protocol | CalDAV / Sync Endpoint | Auth / Requirements |
| :--- | :--- | :--- | :--- |
| **Google / Gmail** | CalDAV / ICS | Direct CalDAV sync or Secret `.ics` iCal feed | Google App Password |
| **Apple iCloud** | CalDAV | `https://caldav.icloud.com/` | Apple ID + [App-Specific Password](https://appleid.apple.com) |
| **Purelymail** | CalDAV | `https://purelymail.com/dav/` | Purelymail password / app credential |
| **Microsoft Outlook / 365** | ICS Sync Feed | Webcal / Published `.ics` link | Copy link from Outlook Web (Settings → Shared Calendars) |
| **Fastmail** | CalDAV | `https://caldav.fastmail.com/dav/` | Fastmail App Password |
| **Yahoo / AOL Mail** | CalDAV | `https://caldav.calendar.yahoo.com/` | Yahoo App Password |
| **Zoho Calendar** | CalDAV | `https://calendar.zoho.com/` (or `.eu`) | Zoho App Password |
| **Mailbox.org** | CalDAV | `https://dav.mailbox.org/caldav/` | Mailbox.org credentials |
| **Posteo** | CalDAV | `https://posteo.de:8443/` | Posteo credentials |
| **GMX Mail** | CalDAV | `https://caldav.gmx.net/begenda/dav/users/{user}/` | GMX credentials |
| **Web.de** | CalDAV | `https://caldav.web.de/begenda/dav/users/{user}/` | Web.de credentials |
| **Nextcloud / ownCloud** | CalDAV | `https://{domain}/remote.php/dav/` | Nextcloud app password / user |
| **Custom / Subscription** | CalDAV or ICS | Any RFC 4791 CalDAV URL or webcal/ics link | Custom credentials or public link |

---

## 🔍 Search Query Syntax Guide

OmniMail supports Gmail-compatible search queries directly in the search bar:

- `from:john@example.com` — Find messages from a specific sender
- `to:team@company.com` — Find messages sent to a recipient
- `subject:"Quarterly Report"` — Match specific subject phrases
- `has:attachment` — Messages containing downloadable file attachments
- `has:invite` — Messages containing calendar invitations (`.ics`)
- `is:unread` or `is:starred` — Filter by read or flagged status
- `larger:5M` or `smaller:500K` — Filter by attachment / message size
- `after:2026-09-01 before:2026-09-24` — Filter within date ranges
- `older_than:7d` — Messages received more than 7 days ago
- `-unwanted` — Exclude messages matching a word

---

## 🚀 Quickstart & How to Use

### 1. Initial Setup & Admin Account
When opening OmniMail for the first time:
1. The app detects that no administrator account exists and presents the **Initial Setup Wizard**.
2. Enter your **Name**, **Master Email**, and a secure **Password** (min. 8 characters).
3. Click **Initialize OmniMail Admin**. OmniMail hashes your password using `scrypt` and generates an encrypted HTTP-only session cookie (`omnimail_session`).
4. You are immediately logged in to the main dashboard.

### 2. Adding Mail & Calendar Accounts
1. Click the **Settings (⚙️)** icon in the top-left sidebar header or the **"+"** next to Mail Accounts.
2. Select **Add Account**.
3. Choose a quick preset (**Gmail**, **iCloud**, **Outlook**, **Yahoo**, **Fastmail**, **Purelymail**, **Zoho**, **Mailbox.org**, **Posteo**, **GMX**, **Nextcloud**, or **Custom**) or type your email address for instant auto-detection.
4. Fill in your credentials (or App-Specific Password).
5. Click **Test Connection** to verify IMAP and SMTP authentication.
6. Click **Save & Sync**. OmniMail will immediately start the initial sync, establish a persistent IMAP `IDLE` push connection, and synchronize your CalDAV calendars.

### 3. Composing & Sending Emails
- Click **New Message** in the sidebar.
- Resize the floating window freely using the bottom-right grab handle or maximize it with the header controls.
- Paste HTML or Markdown directly from your notes—OmniMail formats it automatically.
- Attach files by clicking **Attach File**.
- Click **Send**. The email is delivered via your account's dedicated SMTP server and automatically copied to your account's `Sent` folder.

### 4. Responding to Calendar Invites
- When you receive an invitation email, OmniMail displays a calendar event widget at the top of the reading pane.
- Click **Accept**, **Decline**, or **Tentative**.
- OmniMail automatically records your RSVP and updates your calendar.

---

## 📦 Deployment Guide

### Option A: Deploying on Coolify (Recommended)

OmniMail is built to run effortlessly on [Coolify](https://coolify.io).

1. **Create New Application**: In your Coolify dashboard, select **Add Resource** $\to$ **Public / Private Git Repository**.
2. **Repository URL**: `https://github.com/AltixCode/omnimail` (or your private Forgejo/Git server).
3. **Build Pack**: Select **Dockerfile**.
4. **Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=3000
   HOSTNAME=0.0.0.0
   NEXT_TELEMETRY_DISABLED=1
   APP_SECRET_KEY=generate_a_random_32_character_hex_secret_here
   DATABASE_URL=postgresql://user:password@postgres_host:5432/omnimail?schema=public
   NEXT_PUBLIC_APP_URL=https://webmail.yourdomain.com
   ```
5. **Domains**: Add your custom domain (e.g., `https://webmail.yourdomain.com`).
6. **Deploy**: Click **Deploy**. Coolify will execute the multi-stage Docker build, run database migrations (`prisma db push --skip-generate`), and route SSL traffic via Traefik.

---

### Option B: Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: "3.8"

services:
  omnimail:
    image: ghcr.io/altixcode/omnimail:latest
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOSTNAME=0.0.0.0
      - APP_SECRET_KEY=change_this_to_a_random_32_character_secret_key!
      - DATABASE_URL=postgresql://omnimail:omnimail_secret@db:5432/omnimail?schema=public
      - NEXT_PUBLIC_APP_URL=http://localhost:3000
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: omnimail
      POSTGRES_USER: omnimail
      POSTGRES_PASSWORD: omnimail_secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U omnimail -d omnimail"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

Run:
```bash
docker compose up -d
```
Visit `http://localhost:3000` to complete admin setup.

---

### Option C: Bare Metal / Local Development

**Prerequisites**: Node.js 20+ or 22+, `pnpm` (v10+ or v12+), and PostgreSQL.

```bash
# 1. Clone the repository
git clone https://github.com/AltixCode/omnimail.git
cd omnimail

# 2. Install dependencies
pnpm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and supply your DATABASE_URL and APP_SECRET_KEY

# 4. Generate Prisma client & apply schema
pnpm prisma db push

# 5. Start the development server
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Description | Default |
| --- | :---: | --- | --- |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string | `postgresql://...` |
| `APP_SECRET_KEY` | **Yes** | 32-character key for AES-256-GCM encryption & session signatures | (Required) |
| `NEXT_PUBLIC_APP_URL` | No | Canonical public URL of your deployment | `http://localhost:3000` |
| `PORT` | No | HTTP listening port for container | `3000` |
| `HOSTNAME` | No | Host bind address | `0.0.0.0` |
| `NEXT_TELEMETRY_DISABLED` | No | Disable Next.js anonymous analytics | `1` |

---

## 🧪 Testing & Verification

OmniMail includes automated test and verification scripts:

```bash
# Typecheck TypeScript source
pnpm typecheck

# Run production build
pnpm build

# Run automated integration tests (account creation, folder structure, event streaming)
pnpm test:verify
```

---

## 🤝 Contributing

We welcome community contributions, bug reports, and feature requests!

1. **Fork the repository** on GitHub.
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit your changes**:
   ```bash
   git commit -m "feat: add amazing feature"
   ```
4. **Push to the branch**:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request**.

### Guidelines
- Adhere to the established TypeScript and ESLint standards (`pnpm typecheck`).
- Ensure all crypto operations use authenticated AES-256-GCM.
- Never bypass the DOMPurify and iframe sandboxing wrappers for incoming HTML mail rendering.

---

## 📄 License

OmniMail is open-source software licensed under the **MIT License**. See [LICENSE](LICENSE) for full details.
