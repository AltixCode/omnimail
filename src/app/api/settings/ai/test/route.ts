import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import { testAiTranslation } from "@/lib/translator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = (await getOrCreateDefaultUser(req)) as any;
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    let aiProxyToken = body?.aiProxyToken;
    if (!aiProxyToken || aiProxyToken === "__KEEP__") {
      aiProxyToken = user.aiProxyToken;
    }

    const result = await testAiTranslation({
      aiProxyUrl: body?.aiProxyUrl || user.aiProxyUrl,
      aiProxyToken,
      aiModel: body?.aiModel || user.aiModel,
      targetLanguage: body?.targetLanguage || user.targetLanguage || "English",
    });

    return NextResponse.json(result);
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { success: false, error: err.message || "Failed to test AI translation" },
      { status: 500 },
    );
  }
}
