import { verifySessionToken } from "@/lib/session-token";

/**
 * API paths that answer without a session. Everything else under /api needs
 * a valid signed session (cookie or bearer), checked in src/proxy.ts before
 * any route handler runs. The image proxy stays public because it is loaded
 * from inside the sandboxed (opaque-origin) email iframe, where the session
 * cookie is not sent.
 */
const PUBLIC_EXACT = new Set(["/api/health", "/api/proxy/image"]);
const PUBLIC_PREFIXES = ["/api/auth/"];

export function isPublicApiPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return PUBLIC_EXACT.has(p) || PUBLIC_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export interface ApiAccessInput {
  pathname: string;
  method: string;
  cookieToken?: string | null;
  authorization?: string | null;
}

export function apiAccess({ pathname, method, cookieToken, authorization }: ApiAccessInput): "pass" | "deny" {
  if (method === "OPTIONS") return "pass";
  if (isPublicApiPath(pathname)) return "pass";
  const bearer =
    authorization && authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : null;
  for (const token of [bearer, cookieToken]) {
    if (token && verifySessionToken(token)) return "pass";
  }
  return "deny";
}
