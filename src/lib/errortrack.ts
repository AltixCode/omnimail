/**
 * AltixErrorTrack (Sentry wire-compatible) configuration shared by the server
 * (instrumentation.ts, @sentry/node) and the browser (@sentry/browser).
 *
 * This is a webmail client: an error event must never carry message bodies,
 * subjects, addresses, mailbox credentials or session tokens. Every event and
 * breadcrumb goes through scrubErrorEvent before it leaves the process.
 * No DSN in env means no error tracking — there is deliberately no fallback.
 */

type Json = Record<string, unknown>;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Keys whose values are mail content, addresses or credentials.
const SENSITIVE_KEY_RE =
  /pass|secret|token|auth|cookie|session|body|html|text|subject|snippet|address|^to$|^cc$|^bcc$|^from|recipient|sender|reply|email|content|attachment|ics|dsn|key/i;

export function redactString(s: string): string {
  return s.replace(EMAIL_RE, "[email]");
}

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return redactString(i === -1 ? url : url.slice(0, i));
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      if (
        SENSITIVE_KEY_RE.test(k) &&
        v !== null &&
        typeof v !== "number" &&
        typeof v !== "boolean"
      ) {
        out[k] = "[redacted]";
      } else if (k === "url" && typeof v === "string") {
        out[k] = stripQuery(v);
      } else {
        out[k] = scrubValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

const SAFE_HEADERS = new Set([
  "user-agent",
  "content-type",
  "accept",
  "accept-language",
  "content-length",
  "host",
]);

/** Removes mail content, addresses, credentials and request bodies from a Sentry event. */
export function scrubErrorEvent<T extends Json | null | undefined>(
  event: T,
): T {
  if (!event) return event;
  const e: Json = { ...(event as Json) };

  if (e.request && typeof e.request === "object") {
    const r = e.request as Json;
    const headers: Json = {};
    if (r.headers && typeof r.headers === "object") {
      for (const [k, v] of Object.entries(r.headers as Json)) {
        if (SAFE_HEADERS.has(k.toLowerCase())) headers[k] = v;
      }
    }
    e.request = {
      ...(typeof r.method === "string" ? { method: r.method } : {}),
      ...(typeof r.url === "string" ? { url: stripQuery(r.url) } : {}),
      headers,
    };
  }

  if (e.user && typeof e.user === "object") {
    const id = (e.user as Json).id;
    e.user = id === undefined ? undefined : { id };
  }

  if (typeof e.message === "string") e.message = redactString(e.message);
  if (typeof e.transaction === "string")
    e.transaction = stripQuery(e.transaction);

  if (e.exception && typeof e.exception === "object") {
    const ex = e.exception as Json;
    if (Array.isArray(ex.values)) {
      e.exception = {
        ...ex,
        values: ex.values.map((v: Json) => ({
          ...v,
          ...(typeof v.value === "string"
            ? { value: redactString(v.value) }
            : {}),
          // Local variables can hold decrypted passwords and message bodies.
          ...(v.stacktrace && typeof v.stacktrace === "object"
            ? {
                stacktrace: {
                  ...(v.stacktrace as Json),
                  frames: Array.isArray((v.stacktrace as Json).frames)
                    ? ((v.stacktrace as Json).frames as Json[]).map(
                        (frame) => {
                          const f = { ...frame };
                          delete f.vars;
                          return f;
                        },
                      )
                    : (v.stacktrace as Json).frames,
                },
              }
            : {}),
        })),
      };
    }
  }

  if (Array.isArray(e.breadcrumbs))
    e.breadcrumbs = e.breadcrumbs.map((b) => scrubBreadcrumb(b as Json));
  else if (
    e.breadcrumbs &&
    typeof e.breadcrumbs === "object" &&
    Array.isArray((e.breadcrumbs as Json).values)
  ) {
    e.breadcrumbs = {
      values: ((e.breadcrumbs as Json).values as Json[]).map(scrubBreadcrumb),
    };
  }

  for (const k of ["extra", "contexts", "tags"]) {
    if (e[k] && typeof e[k] === "object") e[k] = scrubValue(e[k]);
  }
  return e as T;
}

export function scrubBreadcrumb<T extends Json | null>(b: T): T {
  if (!b) return b;
  return scrubValue(b) as T;
}

interface BaseOptions {
  dsn: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  // Typed loosely so one object satisfies both @sentry/node and @sentry/browser.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeSend: (event: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beforeBreadcrumb: (breadcrumb: any) => any;
}

function baseOptions(dsn: string | undefined): BaseOptions | null {
  const d = dsn?.trim();
  if (!d) return null;
  return {
    dsn: d,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubErrorEvent(event),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
  };
}

/** Options for @sentry/node; null when ERRORTRACK_DSN is unset. */
export function serverErrorTrackOptions(dsn: string | undefined) {
  const o = baseOptions(dsn);
  return o && { ...o, includeLocalVariables: false };
}

/**
 * Options for @sentry/browser; null when no DSN. No session replay: replay
 * would record rendered mail. No tracing integration either.
 */
export function browserErrorTrackOptions(dsn: string | undefined) {
  return baseOptions(dsn);
}
