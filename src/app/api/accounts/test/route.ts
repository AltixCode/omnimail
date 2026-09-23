import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      imapHost,
      imapPort = 993,
      imapSecure = true,
      imapUser,
      imapPassword,
      smtpHost,
      smtpPort = 587,
      smtpSecure = false,
      smtpUser,
      smtpPassword,
    } = body;

    // Test IMAP
    let imapOk = false;
    let imapError: string | null = null;
    const client = new ImapFlow({
      host: imapHost,
      port: Number(imapPort),
      secure: Boolean(imapSecure),
      auth: {
        user: imapUser,
        pass: imapPassword,
      },
      logger: false,
    });

    try {
      await client.connect();
      imapOk = true;
      await client.logout();
    } catch (err: any) {
      imapError = err?.message || String(err);
    }

    // Test SMTP
    let smtpOk = false;
    let smtpError: string | null = null;
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Boolean(smtpSecure),
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    try {
      await transporter.verify();
      smtpOk = true;
    } catch (err: any) {
      smtpError = err?.message || String(err);
    }

    return NextResponse.json({
      success: imapOk && smtpOk,
      imap: { ok: imapOk, error: imapError },
      smtp: { ok: smtpOk, error: smtpError },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
