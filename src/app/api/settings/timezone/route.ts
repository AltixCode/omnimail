import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import { normalizeTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    return NextResponse.json({
      timezoneMode: user.timezoneMode || "automatic",
      timezone: user.timezone || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();
    const { timezoneMode, timezone } = body;

    if (timezoneMode && timezoneMode !== "automatic" && timezoneMode !== "manual") {
      return NextResponse.json(
        { error: "Invalid timezoneMode. Must be 'automatic' or 'manual'." },
        { status: 400 },
      );
    }

    const dataToUpdate: { timezoneMode?: string; timezone?: string | null } = {};
    if (timezoneMode) {
      dataToUpdate.timezoneMode = timezoneMode;
    }

    if (timezoneMode === "manual" || (user.timezoneMode === "manual" && timezone !== undefined)) {
      if (timezone) {
        const normalized = normalizeTimezone(timezone) || timezone.trim();
        dataToUpdate.timezone = normalized;
      }
    } else if (timezoneMode === "automatic") {
      // Optional: retain or clear manual timezone, or keep as fallback
      if (timezone) {
        dataToUpdate.timezone = normalizeTimezone(timezone) || timezone.trim();
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        name: true,
        timezoneMode: true,
        timezone: true,
      },
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
      timezoneMode: updatedUser.timezoneMode,
      timezone: updatedUser.timezone,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return PATCH(req);
}
