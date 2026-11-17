/**
 * Re-seal every stored mail credential under the current at-rest key.
 *
 * Opens each MailAccount imapPassEnc / smtpPassEnc / caldavPassEnc with the
 * current key or any APP_ENCRYPTION_KEYS_PREVIOUS key, and re-encrypts with
 * the current key (APP_ENCRYPTION_KEY, falling back to APP_SECRET_KEY, exactly
 * as src/lib/crypto.ts does) only the values a previous key opened. Writes run
 * in one transaction and touch only changed fields; a second run changes
 * nothing. If any value opens with no key, nothing is written.
 *
 * Prints counts only: never a credential, ciphertext or key.
 *
 * Plain CommonJS on purpose: the production image has no tsx and no scripts/,
 * so it is run by piping it into the container from /app, e.g.
 *   docker exec -i -w /app <container> node - --apply < scripts/reseal-credentials.cjs
 * Without --apply it is a dry run.
 */
const crypto = require("node:crypto");

const ALGORITHM = "aes-256-gcm";
const FIELDS = ["imapPassEnc", "smtpPassEnc", "caldavPassEnc"];

const deriveKey = (raw) => crypto.createHash("sha256").update(raw).digest();

function keysFromEnv(env) {
  const current = env.APP_ENCRYPTION_KEY || env.APP_SECRET_KEY;
  if (!current) throw new Error("APP_ENCRYPTION_KEY (or APP_SECRET_KEY) must be set");
  const previous = (env.APP_ENCRYPTION_KEYS_PREVIOUS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map(deriveKey);
  return { current: deriveKey(current), previous };
}

function open(parts, key) {
  try {
    const d = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(parts[0], "hex"));
    d.setAuthTag(Buffer.from(parts[1], "hex"));
    return { ok: true, plain: d.update(parts[2], "hex", "utf8") + d.final("utf8") };
  } catch {
    return { ok: false };
  }
}

function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc = c.update(plain, "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

/** @returns {{status: "empty"|"plaintext"|"current"|"resealed"|"undecryptable", value: string|null}} */
function resealValue(cipherText, keys) {
  if (!cipherText) return { status: "empty", value: cipherText };
  const parts = cipherText.split(":");
  // The app reads a value without three parts as legacy plaintext; leave it as it is.
  if (parts.length !== 3) return { status: "plaintext", value: cipherText };
  if (open(parts, keys.current).ok) return { status: "current", value: cipherText };
  for (const key of keys.previous) {
    const r = open(parts, key);
    if (r.ok) return { status: "resealed", value: seal(r.plain, keys.current) };
  }
  return { status: "undecryptable", value: cipherText };
}

async function runReseal(db, keys, { apply }) {
  return db.$transaction(async (tx) => {
    const rows = await tx.mailAccount.findMany({ select: { id: true, imapPassEnc: true, smtpPassEnc: true, caldavPassEnc: true } });
    const tally = {};
    const updates = [];
    for (const row of rows) {
      const data = {};
      for (const f of FIELDS) {
        const r = resealValue(row[f], keys);
        tally[`${f}:${r.status}`] = (tally[`${f}:${r.status}`] || 0) + 1;
        if (r.status === "resealed") data[f] = r.value;
      }
      if (Object.keys(data).length) updates.push({ id: row.id, data });
    }
    const undecryptable = Object.entries(tally)
      .filter(([k]) => k.endsWith(":undecryptable"))
      .reduce((n, [, v]) => n + v, 0);
    const report = { accounts: rows.length, rowsToUpdate: updates.length, rowsUpdated: 0, undecryptable, apply: !!apply, tally };
    if (apply && undecryptable > 0) throw new Error(`refusing to write: ${undecryptable} undecryptable value(s)`);
    if (apply) {
      for (const u of updates) await tx.mailAccount.update({ where: { id: u.id }, data: u.data });
      report.rowsUpdated = updates.length;
    }
    return report;
  });
}

module.exports = { keysFromEnv, resealValue, runReseal };

// Piped through `node -` the module id is "[stdin]" and require.main is unset.
if (require.main === module || module.id === "[stdin]") {
  const apply = process.argv.includes("--apply");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  (async () => {
    const report = await runReseal(prisma, keysFromEnv(process.env), { apply });
    console.log(JSON.stringify(report));
  })()
    .catch((e) => {
      console.error(`reseal failed: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
