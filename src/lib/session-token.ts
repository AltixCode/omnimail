import crypto from "crypto";

// Session-token signing lives here, free of Prisma and next/headers, so the
// request proxy (src/proxy.ts) can verify a token before any route runs.
// Moved from auth.ts, which re-exports it.
//
// Fail closed: there is no fallback key. A public default here once let anyone
// forge a session for any user (prod ran on it until 2026-11-16).
const PUBLIC_DEFAULT_KEYS = new Set(["01234567890123456789012345678901", "omnimail-secret-encryption-key-2026"]);
const MIN_KEY_LENGTH = 32;

/** The session signing key. Throws when APP_SECRET_KEY is unset, short or a known public value. */
export function assertSessionSecret(): string {
  const key = process.env.APP_SECRET_KEY;
  if (!key || key.length < MIN_KEY_LENGTH || PUBLIC_DEFAULT_KEYS.has(key)) {
    throw new Error(`APP_SECRET_KEY must be set to a private value of at least ${MIN_KEY_LENGTH} characters`);
  }
  return key;
}
export const COOKIE_NAME = "omnimail_session";

/**
 * Hashes a plaintext password using standard scrypt + salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verifies a password against the stored salt:hash string
 */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, key] = stored.split(":");
    if (!salt || !key) return false;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(key, "hex");
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

/**
 * Creates a signed session token
 */
export function createSessionToken(userId: string): string {
  const payload = `${userId}:${Date.now()}`;
  const hmac = crypto.createHmac("sha256", assertSessionSecret());
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

/**
 * Verifies and decodes a signed session token
 */
export function verifySessionToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [userId, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Expire after 30 days
    if (Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000) {
      return null;
    }

    const payload = `${userId}:${timestampStr}`;
    const hmac = crypto.createHmac("sha256", assertSessionSecret());
    hmac.update(payload);
    const expectedSig = hmac.digest("hex");

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return userId;
    }
    return null;
  } catch {
    return null;
  }
}

