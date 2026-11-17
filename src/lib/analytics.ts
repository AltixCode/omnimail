/**
 * AltixAnalytics (PostHog-compatible) for OmniMail.
 *
 * Only anonymous page views are sent. Webmail URLs carry message ids, folder
 * ids, calendar event ids and search terms (which are often addresses), so
 * every URL is reduced to a route template before it leaves the browser:
 * known route words are kept, every other path segment becomes ":id", and
 * the query string and fragment are dropped. Anything that looks like an
 * email address anywhere in the event is replaced. Every event other than a
 * page view is dropped. No website id configured means nothing loads.
 */

export const ANALYTICS_HOST = "https://analytics.altixcode.com";

// Static route words used by src/lib/app-navigation.ts. Anything else is data.
const ROUTE_WORDS = new Set([
  "mail",
  "calendar",
  "message",
  "folder",
  "event",
  "search",
  "privacy",
  "inbox",
  "starred",
  "sent",
  "scheduled",
  "outbox",
  "drafts",
  "draft",
  "archive",
  "spam",
  "junk",
  "trash",
  "bin",
  "month",
  "monthly",
  "week",
  "weekly",
  "day",
  "daily",
  "agenda",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function sanitizeAnalyticsPath(pathname: string): string {
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return (
    "/" +
    segments
      .map((s) => (ROUTE_WORDS.has(s.toLowerCase()) ? s.toLowerCase() : ":id"))
      .join("/")
  );
}

export function sanitizeAnalyticsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${sanitizeAnalyticsPath(u.pathname)}`;
  } catch {
    return null;
  }
}

const URL_KEY_RE = /url|referrer|href/i;
const PATH_KEY_RE = /pathname/i;
// Page and element text can contain subjects and sender names.
const DROP_KEY_RE =
  /^(\$?title|\$el_text|\$elements|\$elements_chain|\$set|\$set_once)$/i;

function sanitizeProps(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props || typeof props !== "object") return props;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (DROP_KEY_RE.test(k)) continue;
    if (typeof v === "string") {
      if (PATH_KEY_RE.test(k)) out[k] = sanitizeAnalyticsPath(v);
      else if (URL_KEY_RE.test(k)) {
        if (v === "$direct" || v === "") out[k] = v;
        else {
          const clean = sanitizeAnalyticsUrl(v);
          if (clean) out[k] = clean;
        }
      } else out[k] = v.replace(EMAIL_RE, "[email]");
    } else if (v === null || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // Nested objects/arrays are dropped: nothing in a page view needs them.
  }
  return out;
}

export interface AnalyticsEvent {
  event?: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  [key: string]: unknown;
}

/** PostHog `before_send` hook: keep only scrubbed page views. */
export function sanitizeAnalyticsEvent<T extends AnalyticsEvent>(
  event: T | null,
): T | null {
  if (!event || event.event !== "$pageview") return null;
  return {
    ...event,
    properties: sanitizeProps(event.properties),
    ...(event.$set ? { $set: sanitizeProps(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: sanitizeProps(event.$set_once) } : {}),
  };
}

export function analyticsConfig(websiteId: string | undefined) {
  const id = websiteId?.trim();
  if (!id) return null;
  return {
    websiteId: id,
    options: {
      api_host: ANALYTICS_HOST,
      ui_host: ANALYTICS_HOST,
      person_profiles: "never" as const,
      // Memory only: no cookie and nothing in local storage, so no consent is needed.
      persistence: "memory" as const,
      capture_pageview: "history_change" as const,
      capture_pageleave: false,
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      save_referrer: false,
      before_send: sanitizeAnalyticsEvent,
    },
  };
}
