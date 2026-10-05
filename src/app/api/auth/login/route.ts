import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { verifyPassword, createSessionToken, COOKIE_NAME } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// There is no CAPTCHA in front of this form, so without a limit the password
// is brute-forceable at whatever rate the network allows. Keyed by IP rather
// than failing closed on account lockout, which would let an attacker lock a
// real user out just by guessing their email.
const isLoginRateLimited = createRateLimiter(
  10 * 60 * 1000,
  5,
  "omnimail-login",
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const key =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    // Same "invalid credentials" outcome as a wrong password: a distinct
    // rate-limit response would itself leak that this IP is throttled.
    if (await isLoginRateLimited(key)) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
      },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const isValid = verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const token = createSessionToken(user.id);
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
    });

    response.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("Error logging in:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
