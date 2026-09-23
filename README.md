<div align="center">

# 📬 OmniMail
### Unified Multi-Account Webmail & CalDAV Client

**A modern, lightweight, privacy-first open-source webmail and calendar aggregator with persistent IMAP IDLE push streaming, sandboxed email rendering, and desktop-grade calendar management.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-v20%2B%20%7C%20v22%2B-brightgreen.svg)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16%20App%20Router-black.svg)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B%20%7C%2018-blue.svg)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com)

</div>

---

## 🌟 Key Highlights

- ⚡ **Zero-Refresh Real-Time Push Streaming**: Built on Server-Sent Events (SSE) and persistent IMAP `IDLE` worker loops (`imapflow`). When an email arrives, your browser receives the update instantly with zero page reloads.
- 🔔 **Desktop Notifications & Audio Chimes**: Web Audio API synthesized chimes and HTML5 browser notifications ensure you never miss critical emails.
- 🛡️ **Strict Email Sandboxing & Privacy Shield**: HTML emails are sanitized with DOMPurify and rendered strictly inside sandboxed `<iframe>` wrappers (`sandbox="allow-popups allow-popups-to-escape-sandbox"`). Remote tracking pixels and external images are blocked by default and safely proxied via an on-device gateway.
- ✍️ **Desktop-Class TipTap Rich Composer**: Full formatting toolbar (Bold, Italic, Lists, Quotes, Code blocks, Links), CC/BCC chips, multi-file attachments with base64 and binary streaming, and threaded inline replies.
- 📅 **Integrated CalDAV Calendar**: Connect Google Calendar, Fastmail, Apple iCloud, Nextcloud, or custom CalDAV endpoints. Features Month, Week, Day, and Agenda views with event creation, modification, and recurrence support (`tsdav` + `ical.js`).
- 🔐 **Bank-Grade Credential Vault**: All IMAP, SMTP, and CalDAV passwords are encrypted at rest with AES-256-GCM authenticated cipher. Master passwords are protected via `scrypt` hashing.
- 🗄️ **Multi-Account Aggregation**: Connect unlimited mail and calendar accounts. Browse inboxes separately or view unified aggregation across all accounts with unread counters.
- 🪶 **Ultra-Low Memory Footprint**: Runs in a minimal Alpine/Debian slim container using less than 150MB of idle RAM.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend (SPA)                         │
│  shadcn/ui Mail Split-Panes  │  Schedule-X Calendar  │  Tiptap Editor  │
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

## 🚀 Quickstart & How to Use

### 1. Initial Setup & Admin Account
When you open OmniMail for the first time:
1. The app detects that no administrator account exists and presents the **Initial Setup Wizard**.
2. Enter your **Name**, **Master Email**, and a secure **Password** (min. 8 characters).
3. Click **Initialize OmniMail Admin**. OmniMail securely hashes your password using `scrypt` and generates an encrypted HTTP-only session cookie (`omnimail_session`).
4. You are immediately logged in to the main dashboard.

### 2. Adding Mail & Calendar Accounts
1. Click the **Settings (⚙️)** icon in the top-left sidebar header or the **"+"** next to Mail Accounts.
2. Select **Add Account**.
3. Choose a quick preset (**Fastmail**, **Gmail**, **iCloud**, or **Custom**) or manually fill in your server settings:
   - **Incoming (IMAP)**: Host, Port (typically `993`), SSL/TLS, Username, and Password (or App Password).
   - **Outgoing (SMTP)**: Host, Port (typically `465` or `587`), Username, and Password.
   - **CalDAV (Optional)**: CalDAV server URL to synchronize calendars.
4. Click **Test Connection** to verify IMAP and SMTP authentication with your mail provider.
5. Click **Save & Sync**. OmniMail will immediately start the initial sync and establish a persistent IMAP `IDLE` push connection.

### 3. Composing & Sending Emails
- Click **New Message** in the sidebar.
- Enter recipients (`To`, `Cc`, `Bcc`) by typing and pressing Enter or comma.
- Format your message using the TipTap WYSIWYG editor.
- Click **Attach File** to add documents, photos, or archives.
- Click **Send**. The email is delivered via your account's dedicated SMTP server and automatically copied to your account's `Sent` folder.

### 4. Viewing & Syncing Calendars
- Click **Calendar & CalDAV** in the sidebar apps list.
- Switch between **Month**, **Week**, **Day**, and **Agenda** views.
- Click any time slot or the **New Event** button to schedule a meeting.
- Click **Sync** anytime to force a two-way synchronization with remote CalDAV servers.

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
