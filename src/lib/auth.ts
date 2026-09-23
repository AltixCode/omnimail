import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import prisma from "@/lib/db";

const SECRET_KEY = process.env.APP_SECRET_KEY || "01234567890123456789012345678901";
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
  const hmac = crypto.createHmac("sha256", SECRET_KEY);
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
    const hmac = crypto.createHmac("sha256", SECRET_KEY);
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

/**
 * Resolves current authenticated user from request cookie or Next.js cookies()
 */
export async function getCurrentUser(req?: NextRequest | Request) {
  let token: string | undefined;

  if (req && "cookies" in req && typeof (req as any).cookies?.get === "function") {
    token = (req as any).cookies.get(COOKIE_NAME)?.value;
  } else if (req) {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (match) token = match[1];
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(COOKIE_NAME)?.value;
    } catch {}
  }

  if (!token) return null;

  const userId = verifySessionToken(token);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  return user;
}
