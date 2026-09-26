# OmniMail — Unified Multi-Account Webmail & CalDAV Client

## Handoff & Architecture Guide

**Status**: Built, verified, tested, and containerized for Coolify on Hetzner.

---

## 1. What This Is

OmniMail is an open-source, ultra-low-overhead, unified multi-account webmail and calendar platform built with Next.js 16, React 19, TypeScript, Prisma, and PostgreSQL.

### Core Capabilities:
1. **Multi-Account Aggregation**: Connects arbitrary external IMAP/SMTP accounts (Fastmail, Gmail, iCloud, custom servers) and CalDAV calendar servers.
2. **Real-Time Push Streaming (Zero Manual Refresh)**:
   - Server-Sent Events (SSE) `/api/events` streaming connection kept alive over HTTP/2.
   - Background IMAP `IDLE` pool using `imapflow` listening for `exists` events.
   - When new messages arrive, the UI updates dynamically in real-time.
3. **Browser Desktop Notifications & Gentle Audio Chime**:
   - Web Notifications API integration with focus-on-click.
   - Synthesized gentle dual-tone bell chime using browser Web Audio API (zero external MP3 dependency).
   - Dynamic unread count in browser tab title `(N) OmniMail`.
4. **Sandboxed HTML Email Rendering**:
   - Strict sanitization using `isomorphic-dompurify`.
   - Sandboxed `<iframe>` (`sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"`) preventing script execution, cookie leaks, and CSS bleed.
   - Built-in tracking pixel protection: remote images blocked by default with one-click "Load Images" proxy via `/api/proxy/image`.
5. **CalDAV & Calendar Support**:
   - `tsdav` + `ical.js` RFC 5545 engine.
   - Desktop calendar interface with Month, Week, Day, and Agenda views.
   - Multi-account calendar overlays with color coding.
   - Event creation, deletion, and bi-directional sync.
6. **Outbound SMTP Delivery**:
   - Identity-specific sending via `nodemailer` using the selected account's credentials.
   - Automatic local copy created in the account's "Sent" folder.
7. **Credentials Security**:
   - AES-256-GCM encryption at rest for all stored IMAP, SMTP, and CalDAV credentials.

---

## 2. Infrastructure & Database Deployment

### Hetzner Production Database (Shared Container)
Following the portfolio shared PostgreSQL policy (`docs/agents/09-backend-and-infra.md`):
- **Server**: Hetzner VPS `2.28.42.222`
- **Container Hostname / ID**: `etdq0o61ptxliaff8gn0kjo9`
- **Database Name**: `omnimail` (provisioned & schema migrated)
- **Role**: `omnimail_app` (least-privilege role)
- **Coolify Internal Connection URL**:
  ```env
  DATABASE_URL="postgresql://omnimail_app:OmniMailSecret2026_fef34ab76b787d240e0aff1a@etdq0o61ptxliaff8gn0kjo9:5432/omnimail?schema=public"
  ```

### Local Development Database
- **Host**: `localhost:5432`
- **Database**: `omnimail_dev`
- **Connection URL**:
  ```env
  DATABASE_URL="postgresql://ata@localhost:5432/omnimail_dev?schema=public"
  ```

---

## 3. Coolify Deployment Checklist

When deploying OmniMail on Coolify (`https://coolify.altixcode.com`):
1. Create a new service under Coolify pointing to this Git repository.
2. Select **Dockerfile** as build pack (uses multi-stage Alpine Dockerfile).
3. Set Environment Variables:
   - `DATABASE_URL`: `postgresql://omnimail_app:OmniMailSecret2026_fef34ab76b787d240e0aff1a@etdq0o61ptxliaff8gn0kjo9:5432/omnimail?schema=public`
   - `APP_SECRET_KEY`: `01234567890123456789012345678901` (or 32-byte secret string)
   - `NEXT_PUBLIC_APP_URL`: The production URL (e.g. `https://mail.altixcode.com`)
   - `HOSTNAME`: `::` (already built into Dockerfile for dual IPv4/IPv6 Coolify health checks)
4. Start Command: `npx --no-install prisma migrate deploy && node server.js` (configured in Dockerfile).

---

## 4. Verification Suite

Run verification locally:
```bash
# Typecheck
pnpm typecheck

# Seed database
pnpm db:seed

# End-to-end verification
pnpm test:verify

# Production build
pnpm build
```

---

## 5. Remote Image Privacy & Trusted Senders

- **Protection**: Remote images are blocked by default to prevent tracking pixels and IP leaks.
- **On-Demand Loading**: Users can click "Load Images" to view remote images for a specific session.
- **Persistent Sender Trust**:
  - In email view, clicking "Always load images from this sender" saves the sender or domain to PostgreSQL (`TrustedSender` model).
  - Subsequent emails from this sender or domain automatically render remote images without prompting.
  - Users can stop auto-loading at any time from the banner ("Stop auto-loading").
- **Settings Management**:
  - Settings modal (`AccountModal`) includes a dedicated **Remote Images** tab.
  - Users can view all trusted senders, search/filter the list, delete trusted senders, or manually add new email addresses or entire domains (e.g., `@github.com`).

