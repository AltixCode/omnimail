import assert from "node:assert/strict";
import test from "node:test";

import { apiAccess } from "../src/lib/api-guard";
import { createSessionToken } from "../src/lib/session-token";
import { getOrCreateDefaultUser, UnauthenticatedError } from "../src/lib/user";

const valid = () => createSessionToken("user-123");

test("public API paths pass without any credential", () => {
  for (const p of [
    "/api/health",
    "/api/auth/login",
    "/api/auth/me",
    "/api/auth/register",
    "/api/auth/setup",
    "/api/auth/logout",
    "/api/auth/oidc/login",
    "/api/auth/oidc/callback",
    "/api/proxy/image",
  ]) {
    assert.equal(apiAccess({ pathname: p, method: "GET" }), "pass", p);
  }
});

test("CORS preflight passes", () => {
  assert.equal(
    apiAccess({ pathname: "/api/messages", method: "OPTIONS" }),
    "pass",
  );
});

test("private API paths are denied without a credential", () => {
  for (const p of [
    "/api/accounts",
    "/api/messages",
    "/api/events",
    "/api/calendar",
    "/api/accounts/export",
  ]) {
    assert.equal(apiAccess({ pathname: p, method: "GET" }), "deny", p);
  }
});

test("a lookalike of a public prefix is not public", () => {
  assert.equal(apiAccess({ pathname: "/api/healthz", method: "GET" }), "deny");
  assert.equal(
    apiAccess({ pathname: "/api/auth-export", method: "GET" }),
    "deny",
  );
});

test("private API paths are denied with a forged or garbage credential", () => {
  assert.equal(
    apiAccess({
      pathname: "/api/accounts",
      method: "GET",
      cookieToken: "garbage",
    }),
    "deny",
  );
  assert.equal(
    apiAccess({
      pathname: "/api/accounts",
      method: "GET",
      authorization: "Bearer abc",
    }),
    "deny",
  );
  const forged = Buffer.from(
    `user-123:${Date.now()}:${"0".repeat(64)}`,
  ).toString("base64url");
  assert.equal(
    apiAccess({
      pathname: "/api/accounts",
      method: "GET",
      cookieToken: forged,
    }),
    "deny",
  );
});

test("private API paths pass with a valid cookie or bearer session", () => {
  assert.equal(
    apiAccess({
      pathname: "/api/accounts",
      method: "GET",
      cookieToken: valid(),
    }),
    "pass",
  );
  assert.equal(
    apiAccess({
      pathname: "/api/accounts",
      method: "GET",
      authorization: `Bearer ${valid()}`,
    }),
    "pass",
  );
});

test("getOrCreateDefaultUser never falls back to another user's account when unauthenticated", async () => {
  await assert.rejects(
    getOrCreateDefaultUser(new Request("http://localhost/api/accounts")),
    (err: unknown) => err instanceof UnauthenticatedError,
  );
});

test("getOrCreateDefaultUser rejects a valid token for a user that does not exist", async () => {
  const token = createSessionToken("no-such-user-" + Date.now());
  await assert.rejects(
    getOrCreateDefaultUser(
      new Request("http://localhost/api/accounts", {
        headers: { authorization: `Bearer ${token}` },
      }),
    ),
    (err: unknown) => err instanceof UnauthenticatedError,
  );
});
