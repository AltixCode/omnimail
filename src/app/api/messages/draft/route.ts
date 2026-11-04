import { NextRequest, NextResponse } from "next/server";
import { getOrCreateDefaultUser } from "@/lib/user";
import { saveDraft, deleteDraft } from "@/lib/drafts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();
    const {
      draftId,
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      threadId,
      attachments,
    } = body;

    if (!accountId) {
      return NextResponse.json(
        { error: "Missing required field: accountId" },
        { status: 400 }
      );
    }

    const draft = await saveDraft(user.id, {
      draftId,
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      threadId,
      attachments,
    });

    return NextResponse.json({
      success: true,
      draftId: draft.id,
      draft,
      updatedAt: draft.date.toISOString(),
    });
  } catch (error: any) {
    console.error("Error saving draft:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save draft" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Missing required query parameter: id" },
        { status: 400 }
      );
    }

    const result = await deleteDraft(user.id, id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting draft:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete draft" },
      { status: 500 }
    );
  }
}
