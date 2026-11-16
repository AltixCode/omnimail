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
8. **Mobile Companion Client & Push Notification Dispatcher**:
   - Mobile React Native (Expo) companion app under `Dev/mobile_expo_apps/omnimail`.
   - Full REST support with `Authorization: Bearer <session_token>` header or cookie sessions.
   - Device registration endpoints (`GET/POST/DELETE /api/devices`, `POST /api/devices/test-push`).
   - Push Notification Service (`src/lib/push-notifications.ts`) dispatching via Expo Push Notification API.
   - Automatic background wake-up (`_contentAvailable: true`) on fresh incoming emails (`!isBackfill`) so mobile apps wake up, sync new messages, and alert the user.
   - Automatic invalid/unregistered token pruning.

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
  DATABASE_URL="postgresql://omnimail_app:<password from Coolify env>@etdq0o61ptxliaff8gn0kjo9:5432/omnimail?schema=public"
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
   - `DATABASE_URL`: `postgresql://omnimail_app:<password from Coolify env>@etdq0o61ptxliaff8gn0kjo9:5432/omnimail?schema=public`
   - `APP_SECRET_KEY`: a private random value (`openssl rand -hex 32`). Never the code's built-in fallback: it is public, and anyone who knows it can forge a session for any user
   - `NEXT_PUBLIC_APP_URL`: The production URL (e.g. `https://mail.altixcode.com`)
   - `HOSTNAME`: `::` (already built into Dockerfile for dual IPv4/IPv6 Coolify health checks)
4. Start Command (Dockerfile): `prisma db push --skip-generate && next start`. `db push` runs WITHOUT `--accept-data-loss`, so any schema change that adds a unique index makes the container fail to start: apply the migration SQL by hand first (see §9).

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

---

## 6. Mobile Companion & Push Notifications Architecture

OmniMail includes an official React Native (Expo SDK 52) companion application located at `Dev/mobile_expo_apps/omnimail`.

### Push Dispatch & Wake-Up Pipeline
- **Device Registration**: Client registers its Expo push token via `POST /api/devices`.
- **Background Wake-Up**: When fresh emails arrive (`!isBackfill`), `src/lib/push-notifications.ts` dispatches a push notification with:
  - `_contentAvailable: true` (triggers iOS/Android background wake-up to sync messages).
  - Category `email_actions` providing interactive action buttons (`Reply`, `Archive`, `Mark as Read`).
- **Production Store Setup (Apple APNs & Google FCM v1)**:
  - **Apple (APNs)**: Enable Push Notifications capability on `com.altixcode.omnimail` App ID in Apple Developer Portal. Create an APNs `.p8` key and upload via `eas credentials` (iOS → Push Notifications Key).
  - **Google (FCM v1)**: Create project in Firebase Console with package `com.altixcode.omnimail`. Download `google-services.json` and generate an FCM v1 private key JSON from Firebase Project Settings → Service Accounts. Upload to Expo via `eas credentials` (Android → FCM V1 Service Account Key).

---

## 7. Google Workspace CalDAV & Recurrence Expansion Engine

### Google Workspace & Custom Domain Detection
- Accounts using custom domains (such as `@external.talpasolutions.com` or `@talpa-solutions.com`) hosted on Google Workspace use `imap.gmail.com` as their IMAP host.
- `isGoogleAccount(account)` checks `@gmail.com`, `@googlemail.com`, and whether `imapHost` or `smtpHost` contains `gmail` or `google`.
- For Google accounts, OmniMail automatically discovers and connects to Google's CalDAV endpoint:
  ```
  https://www.google.com/calendar/dav/${encodeURIComponent(username)}/events/
  ```
  using the account's existing Google credentials (or App Password).

### Recurrence (RRULE) RFC 5545 Expansion
- In CalDAV (RFC 5545), recurring events are stored as a master `VEVENT` with an `RRULE` (e.g. `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`), while modified occurrences share the base `UID` with a `RECURRENCE-ID`.
- To avoid unique constraint collisions on `[calendarId, uid]`, modified instances are saved as `${baseUid}#${recurrenceId}`.
- `GET /api/calendar` queries both non-recurring events within the requested window and recurring events (`rrule IS NOT NULL`). It uses `ICAL.Event.iterator()` to expand occurrences dynamically across the active view window, while skipping instances superseded by explicit `#recurrenceId` exceptions.
- **Frontend Views**: The Calendar view provides dedicated, responsive views for **Month** (with event counts and badges), **Week**, **Day** (displaying the current date's schedule with direct meeting launch), and **Agenda** (filtering upcoming events from the selected date onwards).

---

## 8. RFC 5545 Dual Timezone Architecture & Conversion Engine

### Problem & Root Cause Diagnosed
- **Issue**: Events scheduled in Europe/Berlin (e.g. Daily Scrum at 09:30 AM CEST, UTC+2) were being displayed at 12:30 PM in Cyprus (Asia/Nicosia, EEST, UTC+3) instead of 10:30 AM.
- **Root Cause**: `ical.js` has no built-in IANA timezone table in `ICAL.TimezoneService` (only `floating` and `UTC`). When `DTSTART;TZID=Europe/Berlin:20260917T093000` was parsed, `ical.js` marked the zone as `floating` and evaluated `toJSDate()` against the host server's local environment. Because the Docker container runs in UTC, 09:30 wall time was parsed directly as `09:30:00.000Z` UTC (a 2-hour offset error in summer). In Cyprus (`UTC+3`), the browser added 3 hours to `09:30 UTC`, resulting in `12:30`.
- **Accurate Time**: 09:30 CEST in Berlin is **07:30:00.000Z UTC**, which translates to **10:30 AM** in Cyprus.

### Solution & Technical Implementation
1. **Schema & Database Layer**:
   - Added `timezone String?` to `model CalendarEvent` in `prisma/schema.prisma`.
   - Production PostgreSQL table updated (`ALTER TABLE "CalendarEvent" ADD COLUMN IF NOT EXISTS "timezone" text;`).
2. **Deterministic Timezone Conversion Engine (`src/lib/timezone.ts`)**:
   - `wallTimeToUTC(year, month, day, hour, minute, second, timeZone)`: Uses Node's native `Intl.DateTimeFormat` with a two-pass `formatToParts` adjustment to calculate the exact UTC timestamp across standard and daylight-saving boundaries for all 418 IANA timezones and Outlook aliases.
   - `icalTimeToUTC(time, fallbackTzid)`: Extracts the normalized IANA timezone from the iCalendar property parameter or `time.timezone`, accurately computing the true UTC `Date`.
   - `formatTimeDual(start, end, originalTz, userTz, isAllDay)`: Compares the user/device timezone against the original event timezone. If they differ, returns both the user's local time (e.g. `10:30 - 11:00 EEST`) and an original scheduled badge (e.g. `09:30 - 10:00 (Berlin, CEST)`).
3. **CalDAV Sync & Recurrence Expansion**:
   - `src/server/caldav-worker.ts`: Stores the original `timezone` string and true UTC `startDate` / `endDate` on all upserts.
   - `src/app/api/calendar/route.ts`: Evaluates `icalTimeToUTC(next, tzid)` on every iteration of `ICAL.Event.iterator()` so all expanded occurrences carry true UTC timestamps and original `timezone`.
4. **Web & Mobile Presentation**:
   - **Web (`src/components/calendar/CalendarView.tsx`)**: Month, Week, Day, and Agenda views display local device time alongside an indigo badge displaying the original scheduled time and city. Event Detail modal displays both timezones with full location details.
   - **Mobile (`Dev/mobile_expo_apps/omnimail`)**: Event cards and detail sheets format events in device local time with a complementary timezone badge showing original scheduled hours and city name.





---

## 9. Altix integrations (added 2026-11-16)

All optional. An unset variable turns that integration off; there is no fallback id, DSN or secret in code.

| Integration | Variables | When read |
| --- | --- | --- |
| AltixAuth (Authentik OIDC) | `AUTHENTIK_ISSUER` (`https://auth.altixcode.com/application/o/<slug>/`), `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, optional `APP_URL` | runtime |
| AltixAnalytics | `ANALYTICS_WEBSITE_ID` | runtime, per request (root layout) |
| AltixErrorTrack server | `ERRORTRACK_DSN` | runtime (`src/instrumentation.ts`) |
| AltixErrorTrack browser | `ERRORTRACK_DSN_BROWSER` (runtime, preferred) or `NEXT_PUBLIC_ERRORTRACK_DSN` (build time) | see left |

### API authentication (security fix)
Before 2026-11-16, `getOrCreateDefaultUser()` fell back to **the first user in the database** whenever a request had no session. Any anonymous caller could read that user's accounts, messages, calendar and contacts. On 2026-11-16 the live site answered an unauthenticated `GET /api/accounts` with 200 and 31 KB. (Only the status and size were checked, not the body.) Fixed in two layers:
- `src/proxy.ts` (Next 16's renamed middleware, which runs on Node) verifies the signed session (cookie or bearer) for every `/api/*` path. The exceptions are `/api/auth/*`, `/api/health`, `/api/proxy/image` and CORS preflights. A request that fails gets a 401.
- `getOrCreateDefaultUser()` now throws `UnauthenticatedError` and never picks a user.
- Session-token signing moved verbatim to `src/lib/session-token.ts`, so the proxy can import it without Prisma. `auth.ts` re-exports it, and password login behaves exactly as before.

Still open (not fixed here): `/api/events` (SSE) now needs a session. But `eventBus.broadcast` still sends every user's events (new-message from/subject included) to **every** connected client. Filter by the subscriber's account ids before more users join. `/api/proxy/image` is an unauthenticated open image proxy (it blocks private IPs). The web UI fires its data fetches before `/api/auth/me` resolves, which now just shows 401s in the console.

### AltixAuth
- Login: `GET /api/auth/oidc/login?returnTo=/path` → Authentik. Callback (register as redirect URI): **`https://webmail.altixcode.com/api/auth/oidc/callback`**.
- Auth code + PKCE (S256), state + nonce in a 10-minute httpOnly cookie scoped to `/api/auth/oidc`, ID token verified against JWKS (issuer, audience, nonce).
- Mapping: `User.oidcSub` (unique, nullable; migration `20261116000000_add_user_oidc_sub`). Order: by `sub`, then lazy-link to an existing user by email **only if `email_verified` is true** and that user has no other `sub`, else JIT-create a new user.
- **JIT is safe here:** OmniMail is multi-user (open `/api/auth/register`). Every user only ever sees their own `MailAccount`s, so a JIT user starts with an empty, isolated account and gains nothing self-registration does not already give. An unverified email is refused outright, never linked and never used to create a user.
- `/api/auth/setup` no longer adopts an OIDC-created user as the first admin.
- Known residual risk of lazy-linking: OmniMail never verified emails at registration. Someone could pre-register `victim@x` with a password, and the real owner's later SSO sign-in would land in that account. The owner should decide whether to keep lazy-linking.
- Sign-in creates the same `omnimail_session` cookie as the password login. Logout is local only.
- **Deploy order:** run `prisma/migrations/20261116000000_add_user_oidc_sub/migration.sql` against prod before deploying. Otherwise `prisma db push` (without `--accept-data-loss`) refuses the new unique index and the container does not start.
- Authentik provider needs `grant_types=["authorization_code","refresh_token"]` and an email mapping that reports `email_verified`. Without the mapping, every SSO sign-in is refused with "email not verified".

### AltixAnalytics
`posthog-js` loads only when `ANALYTICS_WEBSITE_ID` is set, with host `https://analytics.altixcode.com`. It sends page views only: `before_send` drops every other event. URLs become route templates: known route words stay, every other segment becomes `:id`, and the query and fragment are dropped. Titles and element text are dropped, and email-shaped strings are replaced. Autocapture, session recording, surveys, exceptions, heatmaps and person profiles are off. There is no CSP, so no CSP change was needed.

### AltixErrorTrack
`src/lib/errortrack.ts` holds the shared options and the scrubber. It removes request bodies, cookies and query strings, keeps only safe headers, reduces `user` to its id, drops stack-frame locals, redacts sensitive keys (body/subject/address/password/token…), and redacts email addresses everywhere. The server inits `@sentry/node` in `register()` and exports `onRequestError`. The browser no longer uses session replay (it recorded unmasked mail text) or tracing. The hard-coded fallback DSN was removed.

### NotifyBell: deliberately not added
OmniMail already notifies on new mail three ways: SSE in-app, Web Notifications and Expo push. A bell would duplicate those and would copy mail metadata (subjects, senders) to another service. The one silent event is a failed scheduled send, which already shows in the Scheduled view. Revisit only if failure alerts are wanted while the user is offline.

### Tests
`pnpm test` runs 92 tests, all passing on 2026-11-16. They include `tests/api-auth-guard.test.ts`, `tests/oidc.test.ts` (fake IdP with real RS256 JWKS, plus account resolution against `omnimail_dev`), `tests/analytics.test.ts` and `tests/errortrack.test.ts`. A full SSO round trip ran against `next start` with a local fake IdP: a JIT user was created with zero accounts, and `/api/accounts` returned 200 with an empty list. Password register and login were re-verified. This was not verified against the real Authentik: **UNKNOWN** until the provider is registered.
