import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

const deriveKey = (raw: string): Buffer => crypto.createHash("sha256").update(raw).digest();

/**
 * The at-rest key for stored mail credentials. APP_ENCRYPTION_KEY is separate
 * from the session key so rotating APP_SECRET_KEY never strands stored data;
 * without it the key falls back to APP_SECRET_KEY, which is what sealed every
 * value before the split. No hard-coded key: with neither set, sealing refuses.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY || process.env.APP_SECRET_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY (or APP_SECRET_KEY) must be set to seal stored credentials");
  return deriveKey(raw);
}

/** Current key first, then each APP_ENCRYPTION_KEYS_PREVIOUS entry, for reading values sealed before a rotation. */
function decryptionKeys(): Buffer[] {
  const keys: Buffer[] = [];
  try {
    keys.push(getEncryptionKey());
  } catch {
    // no current key: previous keys may still open old values
  }
  for (const raw of (process.env.APP_ENCRYPTION_KEYS_PREVIOUS ?? "").split(",").map((k) => k.trim()).filter(Boolean)) {
    keys.push(deriveKey(raw));
  }
  return keys;
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
export function encryptSecret(plainText: string): string {
  if (!plainText) return "";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted cipher text.
 */
export function decryptSecret(cipherText: string): string {
  if (!cipherText) return "";
  try {
    const parts = cipherText.split(":");
    if (parts.length !== 3) {
      // In case legacy or plain text was passed
      return cipherText;
    }
    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    for (const key of decryptionKeys()) {
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
      } catch {
        // not this key; try the next
      }
    }
    throw new Error("no configured key opens this value");
  } catch (error) {
    console.error("Failed to decrypt secret:", error);
    return "";
  }
}
