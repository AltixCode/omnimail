import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import { translateEmail } from "@/lib/translator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);

    const body = await req.json();
    const { subject, bodyHtml, bodyText, targetLanguage } = body || {};

    const translation = await translateEmail({
      subject,
      bodyHtml,
      bodyText,
      targetLanguage: targetLanguage || (user as any).targetLanguage || "English",
      aiProxyUrl: (user as any).aiProxyUrl,
      aiProxyToken: (user as any).aiProxyToken,
      aiModel: (user as any).aiModel,
    });

    return NextResponse.json({
      success: true,
      original: {
        subject,
        bodyHtml,
        bodyText,
      },
      translated: translation,
    });
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("General translation API error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to translate content" },
      { status: 500 },
    );
  }
}
