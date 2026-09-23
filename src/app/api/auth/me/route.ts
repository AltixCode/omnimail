import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Check if any admin user with a password exists
    const adminUser = await prisma.user.findFirst({
      where: {
        passwordHash: { not: null },
      },
    });

    const setupRequired = !adminUser;

    const user = await getCurrentUser(req);

    return NextResponse.json({
      authenticated: Boolean(user),
      setupRequired,
      user: user || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
