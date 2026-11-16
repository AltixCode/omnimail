"use client";

import { useEffect } from "react";
import { browserErrorTrackOptions } from "@/lib/errortrack";

let initialized = false;

/**
 * Browser error reporting to AltixErrorTrack. The DSN comes from the server
 * (ERRORTRACK_DSN_BROWSER, read per request in the root layout) or, failing
 * that, the build-time NEXT_PUBLIC_ERRORTRACK_DSN. Neither set: nothing loads.
 */
export function ErrorTracking({ dsn }: { dsn?: string | undefined }) {
  useEffect(() => {
    const options = browserErrorTrackOptions(dsn || process.env.NEXT_PUBLIC_ERRORTRACK_DSN);
    if (!options || initialized) return;
    initialized = true;
    import("@sentry/browser")
      .then(({ init }) => init(options))
      .catch(() => undefined);
  }, [dsn]);

  return null;
}
