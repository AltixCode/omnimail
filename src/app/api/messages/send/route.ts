import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/server/smtp-dispatcher";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      attachments,
    } = body;

    if (!accountId || !to || (!Array.isArray(to) && typeof to !== "string") || !subject) {
      return NextResponse.json(
        { error: "Missing required fields: accountId, to, subject" },
        { status: 400 }
      );
    }

    const toArray = Array.isArray(to)
      ? to
      : to
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);

    const ccArray = cc
      ? Array.isArray(cc)
        ? cc
        : cc
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
      : undefined;

    const bccArray = bcc
      ? Array.isArray(bcc)
        ? bcc
        : bcc
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
      : undefined;

    const result = await sendEmail({
      accountId,
      to: toArray,
      cc: ccArray,
      bcc: bccArray,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      attachments,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error("Error sending message via API:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
