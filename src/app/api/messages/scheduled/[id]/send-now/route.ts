import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import scheduledEmailWorker from "@/server/scheduled-worker";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;
    const cleanId = id.startsWith("sched_") ? id.slice(6) : id;

    const result = await scheduledEmailWorker.sendScheduledEmailNow(cleanId, user.id);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
