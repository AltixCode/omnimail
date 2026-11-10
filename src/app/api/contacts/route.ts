import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import { getContactsForUser } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query") || searchParams.get("q") || undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(500, parseInt(limitParam, 10)) : 200;

    const contacts = await getContactsForUser(user.id, {
      query,
      limit,
    });

    return NextResponse.json({
      contacts,
      total: contacts.length,
    });
  } catch (error: any) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch contacts", contacts: [] },
      { status: 500 }
    );
  }
}
