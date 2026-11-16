import { NextRequest, NextResponse } from "next/server";
import {
  OIDC_STATE_COOKIE,
  encodeOidcState,
  getOidcClient,
  oidcConfig,
  publicOrigin,
  randomToken,
  safeReturnTo,
} from "@/lib/oidc";

export const dynamic = "force-dynamic";

/** GET /api/auth/oidc/login — starts AltixAuth sign-in. 404 when not configured. */
export async function GET(req: NextRequest) {
  const cfg = oidcConfig(process.env, publicOrigin(req));
  if (!cfg) return NextResponse.json({ error: "Single sign-on is not configured" }, { status: 404 });

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  try {
    const url = await getOidcClient(cfg).authorizeUrl({ state, nonce, verifier });
    const res = NextResponse.redirect(url);
    res.cookies.set({
      name: OIDC_STATE_COOKIE,
      value: encodeOidcState({ state, nonce, verifier, returnTo: safeReturnTo(req.nextUrl.searchParams.get("returnTo")) }),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/auth/oidc",
    });
    return res;
  } catch (err) {
    console.error("AltixAuth discovery failed:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/?authError=sso_unavailable", publicOrigin(req)));
  }
}
