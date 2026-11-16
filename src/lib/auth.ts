import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import prisma from "@/lib/db";

export {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  hashPassword,
  verifyPassword,
} from "@/lib/session-token";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session-token";

/**
 * Resolves current authenticated user from request cookie or Next.js cookies()
 */
export async function getCurrentUser(req?: NextRequest | Request) {
  let token: string | undefined;

  // 1. Check Authorization header (for mobile apps / API clients)
  if (req) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  // 2. Check cookies
  if (!token && req && "cookies" in req && typeof (req as any).cookies?.get === "function") {
    token = (req as any).cookies.get(COOKIE_NAME)?.value;
  } else if (!token && req) {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (match) token = match[1];
  }

  // 3. Fallback to Next.js cookies()
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
      timezoneMode: true,
      timezone: true,
      createdAt: true,
    },
  });

  return user;
}
