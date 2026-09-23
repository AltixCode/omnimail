import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { hashPassword, createSessionToken, COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // Only allow setup if no admin user with a password exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        passwordHash: { not: null },
      },
    });

    if (existingAdmin) {
      return NextResponse.json(
        { error: "OmniMail setup has already been completed. Please log in." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { email, name, password } = body;

    if (!email || !password || password.length < 8) {
      return NextResponse.json(
        { error: "Valid email and a password with at least 8 characters are required." },
        { status: 400 }
      );
    }

    const hashedPassword = hashPassword(password);

    // If an initial unconfigured user exists, update it; otherwise create new
    let user = await prisma.user.findFirst();
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: email.trim().toLowerCase(),
          name: name?.trim() || "Administrator",
          passwordHash: hashedPassword,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: email.trim().toLowerCase(),
          name: name?.trim() || "Administrator",
          passwordHash: hashedPassword,
        },
      });
    }

    const token = createSessionToken(user.id);
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
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
    console.error("Error setting up admin account:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
