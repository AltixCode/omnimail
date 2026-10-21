"use client";

import { useEffect } from "react";

let initialized = false;

export function ErrorTracking({ dsn }: { dsn?: string | undefined }) {
  useEffect(() => {
    const activeDsn = dsn || process.env.NEXT_PUBLIC_ERRORTRACK_DSN || "https://2651d5580ea346a0949e71ce0bef5147@errortrack.altixcode.com/529";
    if (!activeDsn || initialized) return;
    initialized = true;
    import("@sentry/browser").then(({ init, browserTracingIntegration, replayIntegration }) => {
      init({
        dsn: activeDsn,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        integrations: [
          browserTracingIntegration(),
          replayIntegration({ maskAllText: false, blockAllMedia: false }),
        ],
      });
    }).catch(() => {
      import("@sentry/browser").then(({ init }) => {
        init({ dsn: activeDsn, tracesSampleRate: 0.1 });
      }).catch(() => undefined);
    });
  }, [dsn]);

  return null;
}
