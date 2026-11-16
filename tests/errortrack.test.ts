import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  scrubErrorEvent,
  serverErrorTrackOptions,
  browserErrorTrackOptions,
} from "../src/lib/errortrack";

test("server error tracking is off without ERRORTRACK_DSN", () => {
  assert.equal(serverErrorTrackOptions(undefined), null);
  assert.equal(serverErrorTrackOptions(""), null);
});

test("server error tracking uses only the configured DSN and never sends PII", () => {
  const o = serverErrorTrackOptions("https://k@errortrack.example/1")!;
  assert.equal(o.dsn, "https://k@errortrack.example/1");
  assert.equal(o.sendDefaultPii, false);
  assert.equal(typeof o.beforeSend, "function");
  assert.equal(typeof o.beforeBreadcrumb, "function");
});

test("browser error tracking is off without a DSN and has no session replay", () => {
  assert.equal(browserErrorTrackOptions(undefined), null);
  assert.equal(browserErrorTrackOptions(""), null);
  const o = browserErrorTrackOptions("https://k@errortrack.example/2")!;
  assert.equal(o.dsn, "https://k@errortrack.example/2");
  assert.equal(o.sendDefaultPii, false);
  assert.equal(
    (o as unknown as Record<string, unknown>).replaysSessionSampleRate,
    undefined,
  );
  assert.equal((o as unknown as Record<string, unknown>).integrations, undefined);
});

test("no hard-coded DSN anywhere in src", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk(path.join(__dirname, "..", "src"));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/https:\/\/[0-9a-f]{16,}@/i.test(src), `hard-coded DSN in ${f}`);
  }
});

test("scrubErrorEvent strips request bodies, cookies, auth headers, user and query strings", () => {
  const out = scrubErrorEvent({
    request: {
      url: "https://webmail.altixcode.com/api/messages/abc?q=from:alice@x.com",
      data: { bodyHtml: "<p>secret</p>", password: "hunter2" },
      cookies: { omnimail_session: "tok" },
      query_string: "q=alice@x.com",
      headers: {
        authorization: "Bearer tok",
        cookie: "omnimail_session=tok",
        "user-agent": "UA",
      },
    },
    user: { id: "u1", email: "me@x.com", ip_address: "1.2.3.4" },
  })!;
  const req = out.request as Record<string, any>;
  assert.equal(req.data, undefined);
  assert.equal(req.cookies, undefined);
  assert.equal(req.query_string, undefined);
  assert.equal(req.url, "https://webmail.altixcode.com/api/messages/abc");
  assert.equal(req.headers.authorization, undefined);
  assert.equal(req.headers.cookie, undefined);
  assert.equal(req.headers["user-agent"], "UA");
  assert.deepEqual(out.user, { id: "u1" });
});

test("scrubErrorEvent redacts addresses in messages, exceptions, breadcrumbs and extras", () => {
  const out = scrubErrorEvent({
    message: "SMTP rejected bob@example.com",
    exception: {
      values: [
        { type: "Error", value: "550 <carol@example.org> mailbox unavailable" },
      ],
    },
    breadcrumbs: [
      {
        message: "sent to dave@example.net",
        data: { to: "dave@example.net", url: "/x" },
      },
    ],
    extra: {
      subject: "Payroll",
      bodyText: "hi",
      imapPassword: "p",
      count: 3,
      info: "eve@example.com",
    },
    contexts: { mail: { smtpPass: "x", host: "smtp.example.com" } },
  })!;
  const s = JSON.stringify(out);
  assert.ok(!s.includes("@example"), s);
  assert.ok(!s.includes("Payroll"));
  assert.ok(!s.includes("hunter"));
  assert.equal((out.extra as any).count, 3);
  assert.equal((out.extra as any).subject, "[redacted]");
  assert.equal((out.extra as any).imapPassword, "[redacted]");
  assert.equal((out.contexts as any).mail.smtpPass, "[redacted]");
  assert.equal((out.contexts as any).mail.host, "smtp.example.com");
  assert.equal(out.message, "SMTP rejected [email]");
});
