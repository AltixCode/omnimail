import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";
import { serializeAccountsForExport } from "@/lib/account-backup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);

    const accounts = await prisma.mailAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const trustedSenders = await prisma.trustedSender.findMany({
      where: { userId: user.id },
      select: { email: true },
      orderBy: { email: "asc" },
    });

    const backupData = serializeAccountsForExport(accounts, {
      timezoneMode: user.timezoneMode || "automatic",
      timezone: user.timezone || null,
      trustedSenders: trustedSenders.map((s) => s.email),
    });

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `omnimail-accounts-${dateStr}.json`;

    return new NextResponse(JSON.stringify(backupData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error: any) {
    console.error("Failed to export accounts:", error);
    return NextResponse.json({ error: error.message || "Failed to export accounts" }, { status: 500 });
  }
}
