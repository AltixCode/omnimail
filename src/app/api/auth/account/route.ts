import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deleteUserAccount } from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/auth/account
 * Permanently deletes the currently authenticated user's OmniMail account
 * and all associated synced data, connected mailbox configs, and push tokens.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await deleteUserAccount(user.id);

    const response = NextResponse.json({ success: true });
    response.cookies.delete(COOKIE_NAME);
    return response;
  } catch (error: any) {
    console.error("Account deletion error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete account" },
      { status: 500 },
    );
  }
}
