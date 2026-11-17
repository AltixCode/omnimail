import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeAnalyticsPath,
  sanitizeAnalyticsUrl,
  sanitizeAnalyticsEvent,
  analyticsConfig,
  ANALYTICS_HOST,
} from "../src/lib/analytics";
import { AltixAnalyticsLoader } from "../src/components/shared/altix-analytics";

test("analyticsConfig is null when no website id is configured", () => {
  assert.equal(analyticsConfig(undefined), null);
  assert.equal(analyticsConfig(""), null);
  assert.equal(analyticsConfig("   "), null);
});

test("analyticsConfig keeps only page views and turns off everything that could read mail", () => {
  const cfg = analyticsConfig("site-1")!;
  assert.equal(cfg.websiteId, "site-1");
  assert.equal(cfg.options.api_host, ANALYTICS_HOST);
  assert.equal(ANALYTICS_HOST, "https://analytics.altixcode.com");
  assert.equal(cfg.options.autocapture, false);
  assert.equal(cfg.options.disable_session_recording, true);
  assert.equal(cfg.options.capture_pageleave, false);
  assert.equal(cfg.options.mask_all_text, true);
  assert.equal(cfg.options.mask_all_element_attributes, true);
  assert.equal(cfg.options.disable_surveys, true);
  assert.equal(cfg.options.capture_exceptions, false);
  assert.equal(cfg.options.person_profiles, "never");
});

test("analyticsConfig stores nothing on the device (no cookie, no local storage)", () => {
  const cfg = analyticsConfig("site-1")!;
  assert.equal(cfg.options.persistence, "memory");
});

test("loader component renders nothing without a website id", () => {
  assert.equal(AltixAnalyticsLoader({ websiteId: undefined }), null);
  assert.equal(AltixAnalyticsLoader({ websiteId: "" }), null);
});

test("sanitizeAnalyticsPath keeps known route words and replaces ids", () => {
  assert.equal(sanitizeAnalyticsPath("/"), "/");
  assert.equal(sanitizeAnalyticsPath("/mail/inbox"), "/mail/inbox");
  assert.equal(
    sanitizeAnalyticsPath("/mail/message/clx123abc"),
    "/mail/message/:id",
  );
  assert.equal(
    sanitizeAnalyticsPath("/mail/folder/f1/m2"),
    "/mail/folder/:id/:id",
  );
  assert.equal(
    sanitizeAnalyticsPath("/calendar/event/event-42_1792056600000"),
    "/calendar/event/:id",
  );
  assert.equal(sanitizeAnalyticsPath("/calendar/week"), "/calendar/week");
  assert.equal(sanitizeAnalyticsPath("/privacy"), "/privacy");
});

test("sanitizeAnalyticsPath never lets an address or search term through", () => {
  assert.equal(
    sanitizeAnalyticsPath("/mail/search/alice%40example.com"),
    "/mail/search/:id",
  );
  assert.equal(
    sanitizeAnalyticsPath("/mail/search/salary review"),
    "/mail/search/:id",
  );
  assert.equal(sanitizeAnalyticsPath("/bob@example.com"), "/:id");
});

test("sanitizeAnalyticsUrl drops query string and fragment", () => {
  assert.equal(
    sanitizeAnalyticsUrl(
      "https://webmail.altixcode.com/mail/message/abc?accountId=a1&q=from%3Aalice%40x.com#top",
    ),
    "https://webmail.altixcode.com/mail/message/:id",
  );
  assert.equal(
    sanitizeAnalyticsUrl(
      "https://webmail.altixcode.com/?notification=email&messageId=m1",
    ),
    "https://webmail.altixcode.com/",
  );
  assert.equal(sanitizeAnalyticsUrl("not a url"), null);
});

test("sanitizeAnalyticsEvent drops every event except page views", () => {
  assert.equal(
    sanitizeAnalyticsEvent({ event: "$autocapture", properties: {} }),
    null,
  );
  assert.equal(
    sanitizeAnalyticsEvent({ event: "$exception", properties: {} }),
    null,
  );
  assert.equal(
    sanitizeAnalyticsEvent({ event: "$snapshot", properties: {} }),
    null,
  );
  assert.equal(
    sanitizeAnalyticsEvent({ event: "custom", properties: {} }),
    null,
  );
  assert.equal(sanitizeAnalyticsEvent(null), null);
});

test("sanitizeAnalyticsEvent scrubs urls, titles and addresses on a page view", () => {
  const out = sanitizeAnalyticsEvent({
    event: "$pageview",
    properties: {
      $current_url:
        "https://webmail.altixcode.com/mail/message/abc?q=alice%40x.com",
      $pathname: "/mail/message/abc",
      $referrer: "https://webmail.altixcode.com/mail/search/bob@example.com",
      $initial_referrer: "https://other.example/x?y=1",
      title: "(3) Re: salary — OmniMail",
      $host: "webmail.altixcode.com",
      note: "contact carol@example.org",
    },
    $set_once: {
      $initial_current_url:
        "https://webmail.altixcode.com/mail/message/zzz?x=1",
    },
  })!;
  assert.ok(out);
  const p = out.properties as Record<string, unknown>;
  assert.equal(
    p.$current_url,
    "https://webmail.altixcode.com/mail/message/:id",
  );
  assert.equal(p.$pathname, "/mail/message/:id");
  assert.equal(p.$referrer, "https://webmail.altixcode.com/mail/search/:id");
  assert.equal(p.$initial_referrer, "https://other.example/:id");
  assert.equal(p.title, undefined);
  assert.equal(p.$host, "webmail.altixcode.com");
  assert.equal(p.note, "contact [email]");
  assert.equal(
    (out.$set_once as Record<string, unknown>).$initial_current_url,
    "https://webmail.altixcode.com/mail/message/:id",
  );
  assert.ok(!JSON.stringify(out).includes("@"));
});
