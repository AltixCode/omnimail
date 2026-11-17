import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { decryptSecret } from "../src/lib/crypto";
// Plain CommonJS so it can be piped into the production container, which has no tsx.
import reseal from "../scripts/reseal-credentials.cjs";

const OLD = "01234567890123456789012345678901";
const NEW = "n".repeat(48);

function seal(plain: string, rawKey: string): string {
  const key = crypto.createHash("sha256").update(rawKey).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = c.update(plain, "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

const keys = () =>
  reseal.keysFromEnv({
    APP_ENCRYPTION_KEY: NEW,
    APP_ENCRYPTION_KEYS_PREVIOUS: ` ${OLD} ,`,
  });

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

/** Minimal stand-in for the Prisma client: records reads, updates and whether they ran in a transaction. */
function fakeDb(rows: Array<Record<string, string | null>>) {
  const state = {
    rows: rows.map((r) => ({ ...r })),
    updates: [] as Array<{ id: string; data: Record<string, string> }>,
    inTx: false,
    txCount: 0,
  };
  const mailAccount = {
    findMany: async () => state.rows.map((r) => ({ ...r })),
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, string>;
    }) => {
      assert.ok(state.inTx, "writes must happen inside the transaction");
      state.updates.push({ id: where.id, data });
      Object.assign(
        state.rows.find((r) => r.id === where.id)!,
        data,
      );
    },
  };
  const db = {
    mailAccount,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.inTx = true;
      state.txCount++;
      try {
        return await fn({ mailAccount });
      } finally {
        state.inTx = false;
      }
    },
  };
  return { db, state };
}

test("keysFromEnv refuses to run without a current key", () => {
  assert.throws(
    () => reseal.keysFromEnv({ APP_ENCRYPTION_KEYS_PREVIOUS: OLD }),
    /APP_ENCRYPTION_KEY/,
  );
});

test("keysFromEnv falls back to APP_SECRET_KEY like the app does", () => {
  const k = reseal.keysFromEnv({ APP_SECRET_KEY: NEW });
  assert.equal(reseal.resealValue(seal("pw", NEW), k).status, "current");
});

test("a value under a previous key is re-sealed so only the current key opens it", () => {
  const out = reseal.resealValue(seal("hunter2", OLD), keys());
  assert.equal(out.status, "resealed");
  withEnv(
    {
      APP_ENCRYPTION_KEY: NEW,
      APP_ENCRYPTION_KEYS_PREVIOUS: undefined,
      APP_SECRET_KEY: undefined,
    },
    () => {
      assert.equal(decryptSecret(out.value ?? ""), "hunter2");
    },
  );
  withEnv(
    { APP_ENCRYPTION_KEY: OLD, APP_ENCRYPTION_KEYS_PREVIOUS: undefined },
    () => {
      assert.equal(
        decryptSecret(out.value ?? ""),
        "",
        "the old key must no longer open it",
      );
    },
  );
});

test("a value already under the current key is left byte-identical", () => {
  const ct = seal("pw", NEW);
  const out = reseal.resealValue(ct, keys());
  assert.equal(out.status, "current");
  assert.equal(out.value, ct);
});

test("empty, null and legacy plaintext values are reported and never rewritten", () => {
  assert.equal(reseal.resealValue("", keys()).status, "empty");
  assert.equal(reseal.resealValue(null, keys()).status, "empty");
  assert.equal(reseal.resealValue("not-sealed", keys()).status, "plaintext");
});

test("a value no key opens is reported, never overwritten", () => {
  const out = reseal.resealValue(
    seal("pw", "some-other-key-entirely-xxxxxxxx"),
    keys(),
  );
  assert.equal(out.status, "undecryptable");
});

test("dry run reports counts and writes nothing", async () => {
  const { db, state } = fakeDb([
    {
      id: "a",
      imapPassEnc: seal("i", OLD),
      smtpPassEnc: seal("s", OLD),
      caldavPassEnc: null,
    },
  ]);
  const r = await reseal.runReseal(db, keys(), { apply: false });
  assert.equal(r.accounts, 1);
  assert.equal(r.rowsToUpdate, 1);
  assert.equal(r.rowsUpdated, 0);
  assert.equal(r.tally["imapPassEnc:resealed"], 1);
  assert.equal(r.tally["caldavPassEnc:empty"], 1);
  assert.equal(state.updates.length, 0);
});

test("apply writes only changed rows and fields, in one transaction, and is idempotent", async () => {
  const keep = seal("s2", NEW);
  const { db, state } = fakeDb([
    {
      id: "a",
      imapPassEnc: seal("i1", OLD),
      smtpPassEnc: seal("s1", OLD),
      caldavPassEnc: seal("c1", OLD),
    },
    {
      id: "b",
      imapPassEnc: seal("i2", OLD),
      smtpPassEnc: keep,
      caldavPassEnc: "",
    },
    {
      id: "c",
      imapPassEnc: seal("i3", NEW),
      smtpPassEnc: seal("s3", NEW),
      caldavPassEnc: null,
    },
  ]);
  const r = await reseal.runReseal(db, keys(), { apply: true });
  assert.equal(state.txCount, 1);
  assert.equal(r.rowsUpdated, 2);
  assert.deepEqual(state.updates.map((u) => u.id).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(state.updates.find((u) => u.id === "b")!.data), [
    "imapPassEnc",
  ]);

  withEnv(
    {
      APP_ENCRYPTION_KEY: NEW,
      APP_ENCRYPTION_KEYS_PREVIOUS: undefined,
      APP_SECRET_KEY: undefined,
    },
    () => {
      assert.equal(decryptSecret(state.rows[0].imapPassEnc!), "i1");
      assert.equal(decryptSecret(state.rows[0].caldavPassEnc!), "c1");
      assert.equal(decryptSecret(state.rows[1].imapPassEnc!), "i2");
    },
  );

  const again = await reseal.runReseal(
    db,
    reseal.keysFromEnv({ APP_ENCRYPTION_KEY: NEW }),
    { apply: true },
  );
  assert.equal(again.rowsToUpdate, 0);
  assert.equal(again.rowsUpdated, 0);
  assert.equal(again.tally["imapPassEnc:current"], 3);
});

test("apply refuses to write anything when any value is undecryptable", async () => {
  const { db, state } = fakeDb([
    {
      id: "a",
      imapPassEnc: seal("i1", OLD),
      smtpPassEnc: seal("s", OLD),
      caldavPassEnc: null,
    },
    {
      id: "b",
      imapPassEnc: seal("i2", "unknown-key-unknown-key-unknown!"),
      smtpPassEnc: seal("s", NEW),
      caldavPassEnc: null,
    },
  ]);
  await assert.rejects(
    reseal.runReseal(db, keys(), { apply: true }),
    /undecryptable/,
  );
  assert.equal(state.updates.length, 0);
});

test("the report carries counts only, never a credential or ciphertext", async () => {
  const { db } = fakeDb([
    {
      id: "a",
      imapPassEnc: seal("s3cret-pw", OLD),
      smtpPassEnc: seal("s3cret-pw", OLD),
      caldavPassEnc: null,
    },
  ]);
  const r = await reseal.runReseal(db, keys(), { apply: true });
  const text = JSON.stringify(r);
  assert.ok(!text.includes("s3cret-pw"));
  assert.ok(!/[0-9a-f]{24}:/.test(text));
});
