import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, createSessionToken } from "@/lib/auth";
import {
  OIDC_STATE_COOKIE,
  OidcLoginRefused,
  decodeOidcState,
  getOidcClient,
  oidcConfig,
  publicOrigin,
  resolveOidcUser,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oidc/callback — AltixAuth redirect URI. Issues the same
 * omnimail_session cookie the password login issues.
 */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/?authError=${code}`, origin));
    res.cookies.set({ name: OIDC_STATE_COOKIE, value: "", maxAge: 0, path: "/api/auth/oidc" });
    return res;
  };

  const cfg = oidcConfig(process.env, origin);
  if (!cfg) return fail("sso_unavailable");

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("sso_cancelled");
  const code = params.get("code");
  const saved = decodeOidcState(req.cookies.get(OIDC_STATE_COOKIE)?.value, params.get("state"));
  if (!code || !saved) return fail("sso_state");

  try {
    const claims = await getOidcClient(cfg).exchange(code, saved.verifier, saved.nonce);
    const user = await resolveOidcUser(claims);
    const res = NextResponse.redirect(new URL(saved.returnTo, origin));
    res.cookies.set({ name: OIDC_STATE_COOKIE, value: "", maxAge: 0, path: "/api/auth/oidc" });
    res.cookies.set({
      name: COOKIE_NAME,
      value: createSessionToken(user.id),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days, same as password login
      path: "/",
    });
    return res;
  } catch (err) {
    if (err instanceof OidcLoginRefused) return fail(err.reason);
    console.error("AltixAuth callback failed:", err instanceof Error ? err.message : err);
    return fail("sso_failed");
  }
}
