import assert from "node:assert/strict";
import test, { after } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import prisma from "../src/lib/db";
import {
  OidcClient,
  oidcConfig,
  pkceChallenge,
  resolveOidcUser,
  OidcLoginRefused,
  safeReturnTo,
} from "../src/lib/oidc";

const ISSUER = "https://auth.test/application/o/omnimail/";
const CLIENT = "omnimail-client";

async function fakeProvider() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "k1",
    alg: "RS256",
    use: "sig",
  };
  let nextClaims: Record<string, unknown> = {};
  const tokenRequests: URLSearchParams[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISSUER}.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: "https://auth.test/application/o/authorize/",
        token_endpoint: "https://auth.test/application/o/token/",
        jwks_uri: "https://auth.test/application/o/omnimail/jwks/",
      });
    }
    if (url === "https://auth.test/application/o/omnimail/jwks/")
      return Response.json({ keys: [jwk] });
    if (url === "https://auth.test/application/o/token/") {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      const idToken = await new SignJWT(nextClaims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(ISSUER)
        .setAudience(CLIENT)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    http,
    setClaims: (c: Record<string, unknown>) => (nextClaims = c),
    tokenRequests,
  };
}

const cfg = {
  issuer: ISSUER,
  clientId: CLIENT,
  clientSecret: "s3cret",
  redirectUri: "https://mail.test/api/auth/oidc/callback",
};

test("oidcConfig is null unless issuer, client id and secret are all set", () => {
  assert.equal(oidcConfig({}, "https://mail.test"), null);
  assert.equal(
    oidcConfig(
      { AUTHENTIK_ISSUER: ISSUER, AUTHENTIK_CLIENT_ID: CLIENT },
      "https://mail.test",
    ),
    null,
  );
  const c = oidcConfig(
    {
      AUTHENTIK_ISSUER: ISSUER,
      AUTHENTIK_CLIENT_ID: CLIENT,
      AUTHENTIK_CLIENT_SECRET: "x",
    },
    "https://mail.test/",
  )!;
  assert.equal(c.redirectUri, "https://mail.test/api/auth/oidc/callback");
});

test("authorizeUrl uses code flow with S256 PKCE, state and nonce", async () => {
  const p = await fakeProvider();
  const client = new OidcClient(cfg, p.http);
  const u = new URL(
    await client.authorizeUrl({ state: "st", nonce: "no", verifier: "ver" }),
  );
  assert.equal(
    u.origin + u.pathname,
    "https://auth.test/application/o/authorize/",
  );
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("client_id"), CLIENT);
  assert.equal(u.searchParams.get("redirect_uri"), cfg.redirectUri);
  assert.equal(u.searchParams.get("scope"), "openid profile email");
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("nonce"), "no");
  assert.equal(u.searchParams.get("code_challenge"), pkceChallenge("ver"));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
});

test("exchange verifies the id token and returns normalized claims", async () => {
  const p = await fakeProvider();
  p.setClaims({
    sub: "sub-1",
    nonce: "n1",
    email: " Alice@Example.COM ",
    email_verified: true,
    name: "Alice",
  });
  const client = new OidcClient(cfg, p.http);
  const claims = await client.exchange("code-1", "ver-1", "n1");
  assert.deepEqual(claims, {
    sub: "sub-1",
    email: "alice@example.com",
    emailVerified: true,
    name: "Alice",
  });
  assert.equal(p.tokenRequests[0].get("code_verifier"), "ver-1");
  assert.equal(p.tokenRequests[0].get("grant_type"), "authorization_code");
});

test("exchange rejects a nonce mismatch", async () => {
  const p = await fakeProvider();
  p.setClaims({ sub: "sub-1", nonce: "other" });
  await assert.rejects(
    new OidcClient(cfg, p.http).exchange("c", "v", "n1"),
    /nonce/,
  );
});

test("exchange rejects a token signed by a different key", async () => {
  const p = await fakeProvider();
  const other = await fakeProvider();
  other.setClaims({ sub: "s", nonce: "n" });
  // discovery + jwks from p, token from other's key
  const mixed = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("/token/")
      ? other.http(input, init)
      : p.http(input, init)) as typeof fetch;
  await assert.rejects(new OidcClient(cfg, mixed).exchange("c", "v", "n"));
});

test("safeReturnTo only allows same-origin relative paths", () => {
  assert.equal(safeReturnTo("/mail/inbox"), "/mail/inbox");
  assert.equal(safeReturnTo("//evil.test/x"), "/");
  assert.equal(safeReturnTo("https://evil.test"), "/");
  assert.equal(safeReturnTo("/\\evil.test"), "/");
  assert.equal(safeReturnTo(null), "/");
});

// ---- account resolution against the dev database ----
const tag = `oidc-${Date.now()}`;
const mk = (s: string) => `${tag}-${s}@example.test`;
after(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  await prisma.$disconnect();
});

test("JIT-provisions an isolated empty account for an unknown verified user", async () => {
  const u = await resolveOidcUser({
    sub: `${tag}-jit`,
    email: mk("jit"),
    emailVerified: true,
    name: "Jit",
  });
  assert.equal(u.email, mk("jit"));
  assert.equal(u.oidcSub, `${tag}-jit`);
  assert.equal(u.passwordHash, null);
  assert.equal(await prisma.mailAccount.count({ where: { userId: u.id } }), 0);
});

test("returns the same user for the same sub even if the email later changes", async () => {
  const a = await resolveOidcUser({
    sub: `${tag}-stable`,
    email: mk("stable"),
    emailVerified: true,
    name: null,
  });
  const b = await resolveOidcUser({
    sub: `${tag}-stable`,
    email: mk("renamed"),
    emailVerified: false,
    name: null,
  });
  assert.equal(a.id, b.id);
});

test("lazy-links an existing password account by verified email and keeps its password", async () => {
  const existing = await prisma.user.create({
    data: { email: mk("legacy"), passwordHash: "salt:hash" },
  });
  const u = await resolveOidcUser({
    sub: `${tag}-legacy`,
    email: mk("legacy"),
    emailVerified: true,
    name: null,
  });
  assert.equal(u.id, existing.id);
  assert.equal(u.oidcSub, `${tag}-legacy`);
  assert.equal(u.passwordHash, "salt:hash");
});

test("refuses to link or create when the email is not verified", async () => {
  await prisma.user.create({ data: { email: mk("unverified") } });
  await assert.rejects(
    resolveOidcUser({
      sub: `${tag}-unv`,
      email: mk("unverified"),
      emailVerified: false,
      name: null,
    }),
    (e: unknown) => e instanceof OidcLoginRefused,
  );
  await assert.rejects(
    resolveOidcUser({
      sub: `${tag}-unv2`,
      email: mk("brand-new"),
      emailVerified: false,
      name: null,
    }),
    (e: unknown) => e instanceof OidcLoginRefused,
  );
  assert.equal(
    await prisma.user.count({ where: { email: mk("brand-new") } }),
    0,
  );
});

test("refuses to link an email already bound to a different sub", async () => {
  await resolveOidcUser({
    sub: `${tag}-owner`,
    email: mk("taken"),
    emailVerified: true,
    name: null,
  });
  await assert.rejects(
    resolveOidcUser({
      sub: `${tag}-intruder`,
      email: mk("taken"),
      emailVerified: true,
      name: null,
    }),
    (e: unknown) => e instanceof OidcLoginRefused,
  );
});

test("refuses when the provider sends no email", async () => {
  await assert.rejects(
    resolveOidcUser({
      sub: `${tag}-noemail`,
      email: null,
      emailVerified: false,
      name: null,
    }),
    (e: unknown) => e instanceof OidcLoginRefused,
  );
});

test("state cookie round-trips and rejects tampering or a wrong state", async () => {
  const { encodeOidcState, decodeOidcState } = await import("../src/lib/oidc");
  const raw = encodeOidcState({ state: "s1", nonce: "n1", verifier: "v1", returnTo: "/mail/inbox" });
  assert.deepEqual(decodeOidcState(raw, "s1"), { state: "s1", nonce: "n1", verifier: "v1", returnTo: "/mail/inbox" });
  assert.equal(decodeOidcState(raw, "s2"), null);
  assert.equal(decodeOidcState(undefined, "s1"), null);
  assert.equal(decodeOidcState("not-json", "s1"), null);
  assert.equal(decodeOidcState(raw, null), null);
  const evil = encodeOidcState({ state: "s1", nonce: "n1", verifier: "v1", returnTo: "https://evil.test" });
  assert.equal(decodeOidcState(evil, "s1")!.returnTo, "/");
});
