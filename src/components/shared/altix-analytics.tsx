"use client";

import { useEffect } from "react";
import { analyticsConfig } from "@/lib/analytics";

let started = false;

/**
 * Loads AltixAnalytics only when the server passed a website id
 * (ANALYTICS_WEBSITE_ID, read per request in the root layout). Sends
 * scrubbed page views only — see src/lib/analytics.ts.
 */
function AltixAnalyticsEffect({ websiteId }: { websiteId: string }) {
  useEffect(() => {
    const cfg = analyticsConfig(websiteId);
    if (!cfg || started) return;
    started = true;
    import("posthog-js")
      .then(({ default: posthog }) => {
        // before_send receives PostHog's CaptureResult; the sanitizer only
        // reads event/properties/$set/$set_once, so the cast is structural.
        posthog.init(
          cfg.websiteId,
          cfg.options as unknown as Parameters<typeof posthog.init>[1],
        );
      })
      .catch(() => undefined);
  }, [websiteId]);
  return null;
}

export function AltixAnalyticsLoader({
  websiteId,
}: {
  websiteId: string | undefined;
}) {
  if (!websiteId || !websiteId.trim()) return null;
  return <AltixAnalyticsEffect websiteId={websiteId.trim()} />;
}
