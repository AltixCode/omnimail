import { serverErrorTrackOptions, scrubErrorEvent } from "@/lib/errortrack";
import { assertSessionSecret } from "@/lib/session-token";

let errorTrackReady = false;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail closed: never serve sessions signed with a missing or public key.
    assertSessionSecret();

    const options = serverErrorTrackOptions(process.env.ERRORTRACK_DSN);
    if (options) {
      try {
        const Sentry = await import("@sentry/node");
        Sentry.init(options);
        errorTrackReady = true;
      } catch (err) {
        console.warn("ErrorTrack init failed:", err instanceof Error ? err.message : err);
      }
    }

    try {
      const { scheduledEmailWorker } = await import("@/server/scheduled-worker");
      scheduledEmailWorker.start();
    } catch (err) {
      console.warn("Failed to auto-start scheduled email worker:", err);
    }
  }
}

/**
 * Next.js calls this for uncaught errors in route handlers, server components
 * and server actions. Only the method and the path (no query string) of the
 * request are attached; headers, cookies and bodies never are.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (!errorTrackReady || process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.withScope((scope) => {
      scope.setTag("routeType", context.routeType);
      scope.setTag("routePath", context.routePath);
      scope.addEventProcessor((event) =>
        scrubErrorEvent({
          ...event,
          request: { method: request.method, url: request.path },
        } as Record<string, unknown>) as typeof event,
      );
      Sentry.captureException(error);
    });
  } catch {
    // Error reporting must never break the request.
  }
}
