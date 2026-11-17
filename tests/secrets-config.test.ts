import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { decryptSecret, encryptSecret } from "../src/lib/crypto";
import { assertSessionSecret, createSessionToken, verifySessionToken } from "../src/lib/session-token";

const PUBLIC_FALLBACK = "01234567890123456789012345678901";
const STRONG = "s".repeat(24) + "t".repeat(24);

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// Seal exactly like the pre-split code did: AES-256-GCM, key = sha256(raw key string).
function legacySeal(plain: string, rawKey: string): string {
  const key = crypto.createHash("sha256").update(rawKey).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = c.update(plain, "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

test("session signing refuses to run without APP_SECRET_KEY", () => {
  withEnv({ APP_SECRET_KEY: undefined }, () => {
    assert.throws(() => createSessionToken("u1"), /APP_SECRET_KEY/);
    assert.throws(() => assertSessionSecret(), /APP_SECRET_KEY/);
  });
});

test("session signing refuses the old public fallback and short keys", () => {
  for (const bad of [PUBLIC_FALLBACK, "short"]) {
    withEnv({ APP_SECRET_KEY: bad }, () => {
      assert.throws(() => createSessionToken("u1"), /APP_SECRET_KEY/);
    });
  }
});

test("a token forged with the old public fallback never verifies", () => {
  withEnv({ APP_SECRET_KEY: STRONG }, () => {
    const payload = `victim:${Date.now()}`;
    const sig = crypto.createHmac("sha256", PUBLIC_FALLBACK).update(payload).digest("hex");
    const forged = Buffer.from(`${payload}:${sig}`).toString("base64url");
    assert.equal(verifySessionToken(forged), null);
    assert.ok(verifySessionToken(createSessionToken("u1")));
  });
});

test("at-rest key comes from APP_ENCRYPTION_KEY, independent of the session key", () => {
  withEnv({ APP_ENCRYPTION_KEY: "enc-key-A".repeat(4), APP_SECRET_KEY: STRONG, APP_ENCRYPTION_KEYS_PREVIOUS: undefined }, () => {
    const sealed = encryptSecret("imap-pass");
    process.env.APP_SECRET_KEY = "x".repeat(48); // rotating the session key must not touch stored data
    assert.equal(decryptSecret(sealed), "imap-pass");
  });
});

test("values sealed under a previous key still decrypt (rotation without data loss)", () => {
  const old = legacySeal("smtp-pass", PUBLIC_FALLBACK);
  withEnv({ APP_ENCRYPTION_KEY: "new-at-rest-key".repeat(3), APP_ENCRYPTION_KEYS_PREVIOUS: ` other-key , ${PUBLIC_FALLBACK}` }, () => {
    assert.equal(decryptSecret(old), "smtp-pass");
  });
  withEnv({ APP_ENCRYPTION_KEY: "new-at-rest-key".repeat(3), APP_ENCRYPTION_KEYS_PREVIOUS: undefined }, () => {
    assert.equal(decryptSecret(old), "");
  });
});

test("without APP_ENCRYPTION_KEY the at-rest key falls back to APP_SECRET_KEY (pre-split behaviour)", () => {
  const old = legacySeal("p", STRONG);
  withEnv({ APP_ENCRYPTION_KEY: undefined, APP_SECRET_KEY: STRONG, APP_ENCRYPTION_KEYS_PREVIOUS: undefined }, () => {
    assert.equal(decryptSecret(old), "p");
  });
});

test("no at-rest key at all refuses to encrypt rather than using a hard-coded one", () => {
  withEnv({ APP_ENCRYPTION_KEY: undefined, APP_SECRET_KEY: undefined }, () => {
    assert.throws(() => encryptSecret("p"), /APP_ENCRYPTION_KEY/);
  });
});

test("server start-up refuses to boot without a private APP_SECRET_KEY", async () => {
  const { register } = await import("../src/instrumentation");
  for (const bad of [undefined, PUBLIC_FALLBACK]) {
    const saved = { k: process.env.APP_SECRET_KEY, r: process.env.NEXT_RUNTIME };
    if (bad === undefined) delete process.env.APP_SECRET_KEY;
    else process.env.APP_SECRET_KEY = bad;
    process.env.NEXT_RUNTIME = "nodejs";
    try {
      await assert.rejects(register(), /APP_SECRET_KEY/);
    } finally {
      if (saved.k === undefined) delete process.env.APP_SECRET_KEY;
      else process.env.APP_SECRET_KEY = saved.k;
      if (saved.r === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = saved.r;
    }
  }
});
