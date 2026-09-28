import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getUserDeviceTokens,
} from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const devices = await getUserDeviceTokens(user.id);
    return NextResponse.json({ success: true, devices });
  } catch (error: any) {
    console.error("GET /api/devices error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { token, platform, deviceId, deviceModel } = body;

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const device = await registerDeviceToken({
      userId: user.id,
      token,
      platform: platform || "unknown",
      deviceId,
      deviceModel,
    });

    return NextResponse.json({ success: true, device });
  } catch (error: any) {
    console.error("POST /api/devices error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let token = req.nextUrl.searchParams.get("token");
    if (!token) {
      try {
        const body = await req.json();
        token = body.token;
      } catch {}
    }

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    await unregisterDeviceToken(user.id, token);
    return NextResponse.json({ success: true, message: "Device unregistered" });
  } catch (error: any) {
    console.error("DELETE /api/devices error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
