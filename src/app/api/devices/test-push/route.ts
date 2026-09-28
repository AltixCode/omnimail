import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendPushNotificationToUser } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let title = "OmniMail Test Notification";
    let body = "Push notification delivered successfully to your mobile device.";
    try {
      const data = await req.json();
      if (data.title) title = data.title;
      if (data.body) body = data.body;
    } catch {}

    const result = await sendPushNotificationToUser(user.id, {
      title,
      body,
      data: { type: "test", timestamp: Date.now() },
    });

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("POST /api/devices/test-push error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
