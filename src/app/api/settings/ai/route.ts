import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import { DEFAULT_AI_PROXY_URL, DEFAULT_MODEL } from "@/lib/translator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = (await getOrCreateDefaultUser(req)) as any;
    return NextResponse.json({
      aiProxyUrl: user.aiProxyUrl || "",
      hasCustomToken: Boolean(user.aiProxyToken),
      aiProxyTokenMasked: user.aiProxyToken ? "••••••••" : "",
      aiModel: user.aiModel || "",
      targetLanguage: user.targetLanguage || "English",
      defaultUrl: DEFAULT_AI_PROXY_URL,
      defaultModel: DEFAULT_MODEL,
      effectiveUrl: user.aiProxyUrl || DEFAULT_AI_PROXY_URL,
      effectiveModel: user.aiModel || DEFAULT_MODEL,
    });
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || "Failed to load AI settings" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = (await getOrCreateDefaultUser(req)) as any;
    const body = await req.json();
    const { aiProxyUrl, aiProxyToken, aiModel, targetLanguage } = body;

    const dataToUpdate: Record<string, any> = {};

    if (aiProxyUrl !== undefined) {
      dataToUpdate.aiProxyUrl = aiProxyUrl?.trim() || null;
    }

    if (aiProxyToken !== undefined) {
      // If client sends empty string, clear custom token (revert to default)
      // If client sends "__KEEP__", don't change
      if (aiProxyToken === "") {
        dataToUpdate.aiProxyToken = null;
      } else if (aiProxyToken !== "__KEEP__") {
        dataToUpdate.aiProxyToken = aiProxyToken.trim();
      }
    }

    if (aiModel !== undefined) {
      dataToUpdate.aiModel = aiModel?.trim() || null;
    }

    if (targetLanguage !== undefined) {
      dataToUpdate.targetLanguage = targetLanguage?.trim() || "English";
    }

    const updatedUser = (await prisma.user.update({
      where: { id: user.id },
      data: dataToUpdate,
    })) as any;

    return NextResponse.json({
      success: true,
      aiProxyUrl: updatedUser.aiProxyUrl || "",
      hasCustomToken: Boolean(updatedUser.aiProxyToken),
      aiProxyTokenMasked: updatedUser.aiProxyToken ? "••••••••" : "",
      aiModel: updatedUser.aiModel || "",
      targetLanguage: updatedUser.targetLanguage || "English",
      defaultUrl: DEFAULT_AI_PROXY_URL,
      defaultModel: DEFAULT_MODEL,
      effectiveUrl: updatedUser.aiProxyUrl || DEFAULT_AI_PROXY_URL,
      effectiveModel: updatedUser.aiModel || DEFAULT_MODEL,
    });
  } catch (err: any) {
    if (err.name === "UnauthenticatedError" || err.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || "Failed to update AI settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return PATCH(req);
}
