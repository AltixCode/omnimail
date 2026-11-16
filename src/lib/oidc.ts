import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { Prisma, type User } from "@prisma/client";
import prisma from "@/lib/db";

/**
 * AltixAuth = Authentik as an OpenID Connect provider (authorization code +
 * PKCE, nonce, JWKS-verified ID token). It runs alongside the original
 * email/password login, which is untouched.
 *
 * Account mapping: by `sub` first; otherwise link to an existing OmniMail
 * user with the same email, but only when Authentik says the email is
 * verified; otherwise create a new, empty, isolated user (no mail accounts —
 * the same thing /api/auth/register already lets anyone create).
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const OIDC_CALLBACK_PATH = "/api/auth/oidc/callback";
export const OIDC_STATE_COOKIE = "omnimail_oidc";

type EnvLike = Record<string, string | undefined>;

export function oidcConfig(
  env: EnvLike,
  publicOrigin: string,
): OidcConfig | null {
  const issuer = env.AUTHENTIK_ISSUER?.trim();
  const clientId = env.AUTHENTIK_CLIENT_ID?.trim();
  const clientSecret = env.AUTHENTIK_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${publicOrigin.replace(/\/+$/, "")}${OIDC_CALLBACK_PATH}`,
  };
}

export function oidcEnabled(env: EnvLike = process.env): boolean {
  return Boolean(
    env.AUTHENTIK_ISSUER?.trim() &&
    env.AUTHENTIK_CLIENT_ID?.trim() &&
    env.AUTHENTIK_CLIENT_SECRET?.trim(),
  );
}

/**
 * Public origin for the redirect URI. APP_URL wins; otherwise the proxy's
 * forwarded headers. A spoofed Host only yields a redirect_uri Authentik
 * rejects, because Authentik matches redirect URIs exactly.
 */
export function publicOrigin(req: Request, env: EnvLike = process.env): string {
  const fixed = env.APP_URL?.trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  const h = req.headers;
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host") ||
    new URL(req.url).host;
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Only same-origin relative paths; anything else becomes "/". */
export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return "/";
  return value;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const b64url = (b: Buffer) => b.toString("base64url");
export const randomToken = () => b64url(randomBytes(32));
export const pkceChallenge = (verifier: string) =>
  b64url(createHash("sha256").update(verifier).digest());

export interface OidcClaims {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export class OidcClient {
  private discovery: { at: number; doc: Discovery } | null = null;
  private jwks: {
    at: number;
    set: ReturnType<typeof createLocalJWKSet>;
  } | null = null;
  constructor(
    readonly cfg: OidcConfig,
    private http: typeof fetch = fetch,
  ) {}

  private async get<T>(url: string): Promise<T> {
    const r = await this.http(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`OIDC ${url} -> ${r.status}`);
    return (await r.json()) as T;
  }

  async meta(): Promise<Discovery> {
    if (this.discovery && Date.now() - this.discovery.at < 3_600_000)
      return this.discovery.doc;
    const base = this.cfg.issuer.endsWith("/")
      ? this.cfg.issuer
      : `${this.cfg.issuer}/`;
    const doc = await this.get<Discovery>(
      `${base}.well-known/openid-configuration`,
    );
    this.discovery = { at: Date.now(), doc };
    return doc;
  }

  async authorizeUrl(p: {
    state: string;
    nonce: string;
    verifier: string;
  }): Promise<string> {
    const m = await this.meta();
    const u = new URL(m.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      scope: "openid profile email",
      state: p.state,
      nonce: p.nonce,
      code_challenge: pkceChallenge(p.verifier),
      code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }

  private async keys(refresh = false) {
    if (!refresh && this.jwks && Date.now() - this.jwks.at < 600_000)
      return this.jwks.set;
    const set = createLocalJWKSet(
      await this.get<JSONWebKeySet>((await this.meta()).jwks_uri),
    );
    this.jwks = { at: Date.now(), set };
    return set;
  }

  /** Exchanges the code and returns the verified ID-token claims. Throws on anything off. */
  async exchange(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<OidcClaims> {
    const m = await this.meta();
    const r = await this.http(m.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.cfg.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code_verifier: verifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`token endpoint ${r.status}`);
    const tok = (await r.json()) as { id_token?: string };
    if (!tok.id_token) throw new Error("no id_token");
    const opts = {
      issuer: m.issuer,
      audience: this.cfg.clientId,
      algorithms: ["RS256", "ES256", "EdDSA"],
      clockTolerance: 30,
    };
    let payload;
    try {
      ({ payload } = await jwtVerify(tok.id_token, await this.keys(), opts));
    } catch (e) {
      // Keys rotate: retry once with a fresh key set before giving up.
      if ((e as { code?: string }).code !== "ERR_JWKS_NO_MATCHING_KEY") throw e;
      ({ payload } = await jwtVerify(
        tok.id_token,
        await this.keys(true),
        opts,
      ));
    }
    if (payload.nonce !== nonce) throw new Error("nonce mismatch");
    if (typeof payload.sub !== "string" || !payload.sub)
      throw new Error("no subject");
    return {
      sub: payload.sub,
      email:
        typeof payload.email === "string"
          ? payload.email.trim().toLowerCase()
          : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  }
}

let cached: { key: string; client: OidcClient } | null = null;
/** One client per config so discovery and JWKS are cached across requests. */
export function getOidcClient(cfg: OidcConfig): OidcClient {
  const key = JSON.stringify(cfg);
  if (!cached || cached.key !== key)
    cached = { key, client: new OidcClient(cfg) };
  return cached.client;
}

/** A sign-in that must not proceed; `reason` is safe to show the user. */
export class OidcLoginRefused extends Error {
  constructor(
    readonly reason:
      "email_unverified" | "email_missing" | "email_linked_elsewhere",
  ) {
    super(reason);
    this.name = "OidcLoginRefused";
  }
}

export async function resolveOidcUser(claims: OidcClaims): Promise<User> {
  const bySub = await prisma.user.findUnique({
    where: { oidcSub: claims.sub },
  });
  if (bySub) return bySub;

  if (!claims.email) throw new OidcLoginRefused("email_missing");
  // An unverified email may belong to someone else: never link on it, and
  // never create a user with it either (email is unique, so that would squat
  // the address for its real owner).
  if (!claims.emailVerified) throw new OidcLoginRefused("email_unverified");

  const byEmail = await prisma.user.findUnique({
    where: { email: claims.email },
  });
  if (byEmail) {
    if (byEmail.oidcSub && byEmail.oidcSub !== claims.sub)
      throw new OidcLoginRefused("email_linked_elsewhere");
    const linked = await prisma.user.updateMany({
      where: { id: byEmail.id, oidcSub: null },
      data: { oidcSub: claims.sub },
    });
    if (linked.count === 0)
      throw new OidcLoginRefused("email_linked_elsewhere");
    return prisma.user.findUniqueOrThrow({ where: { id: byEmail.id } });
  }

  try {
    return await prisma.user.create({
      data: {
        email: claims.email,
        name: claims.name?.trim() || claims.email.split("@")[0],
        oidcSub: claims.sub,
      },
    });
  } catch (e) {
    // Two concurrent first sign-ins for the same sub: the loser re-reads.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const again = await prisma.user.findUnique({
        where: { oidcSub: claims.sub },
      });
      if (again) return again;
      throw new OidcLoginRefused("email_linked_elsewhere");
    }
    throw e;
  }
}

export interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

/**
 * The PKCE verifier, nonce and state travel in a short-lived httpOnly cookie
 * scoped to /api/auth/oidc. Tampering gains nothing: the state must match
 * the query string, and the verifier/nonce are checked by Authentik and by
 * the ID-token verification respectively.
 */
export function encodeOidcState(s: OidcState): string {
  return Buffer.from(JSON.stringify(s)).toString("base64url");
}

export function decodeOidcState(raw: string | undefined, queryState: string | null): OidcState | null {
  if (!raw || !queryState) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OidcState>;
    if (typeof s.state !== "string" || typeof s.nonce !== "string" || typeof s.verifier !== "string") return null;
    if (s.state !== queryState) return null;
    return { state: s.state, nonce: s.nonce, verifier: s.verifier, returnTo: safeReturnTo(s.returnTo) };
  } catch {
    return null;
  }
}
