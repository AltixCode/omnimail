import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import prisma from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let imapHost = body.imapHost;
    let imapPort = body.imapPort ? Number(body.imapPort) : 993;
    let imapSecure = body.imapSecure !== undefined ? Boolean(body.imapSecure) : true;
    let imapUser = body.imapUser;
    let imapPassword = body.imapPassword;

    let smtpHost = body.smtpHost;
    let smtpPort = body.smtpPort ? Number(body.smtpPort) : 465;
    let smtpSecure = body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : true;
    let smtpUser = body.smtpUser;
    let smtpPassword = body.smtpPassword || imapPassword;

    // If accountId is provided, load and decrypt from database
    if (body.accountId) {
      const account = await prisma.mailAccount.findUnique({
        where: { id: body.accountId },
      });
      if (!account) {
        return NextResponse.json({ error: "Account not found" }, { status: 404 });
      }

      imapHost = account.imapHost;
      imapPort = account.imapPort;
      imapSecure = account.imapSecure;
      imapUser = account.imapUser;
      imapPassword = decryptSecret(account.imapPassEnc);

      smtpHost = account.smtpHost;
      smtpPort = account.smtpPort;
      smtpSecure = account.smtpSecure;
      smtpUser = account.smtpUser;
      smtpPassword = decryptSecret(account.smtpPassEnc);
    }

    if (!imapHost || !imapUser || !imapPassword) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing IMAP credentials",
          imap: { ok: false, error: "Missing host, username or password" },
          smtp: { ok: false, error: "Missing host, username or password" },
        },
        { status: 400 }
      );
    }

    // Gmail-specific handling: strip spaces from 16-char app passwords
    if (imapHost.includes("gmail.com") && imapPassword) {
      const clean = imapPassword.replace(/\s+/g, "");
      if (clean.length === 16) {
        imapPassword = clean;
      }
    }
    if (smtpHost && smtpHost.includes("gmail.com") && smtpPassword) {
      const clean = smtpPassword.replace(/\s+/g, "");
      if (clean.length === 16) {
        smtpPassword = clean;
      }
    }

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
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 6000,
      logger: false,
    });

    try {
      await client.connect();
      imapOk = true;
      await client.logout().catch(() => {});
    } catch (err: any) {
      let rawMsg = err?.responseText || err?.message || String(err);
      if (imapHost.includes("gmail.com") && (rawMsg.includes("AUTHENTICATIONFAILED") || rawMsg.includes("Invalid credentials") || rawMsg.includes("Command failed"))) {
        imapError = "Gmail authentication failed: Google requires a 16-character App Password (create at myaccount.google.com/apppasswords). Standard Google passwords and 2FA cannot be used with IMAP.";
      } else {
        imapError = rawMsg;
      }
    }

    // Test SMTP
    let smtpOk = false;
    let smtpError: string | null = null;

    if (smtpHost) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort),
        secure: Boolean(smtpSecure),
        connectionTimeout: 6000,
        greetingTimeout: 6000,
        socketTimeout: 6000,
        auth: {
          user: smtpUser || imapUser,
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
        let rawMsg = err?.response || err?.message || String(err);
        if (smtpHost.includes("gmail.com") && (rawMsg.includes("BadCredentials") || rawMsg.includes("Username and Password not accepted") || rawMsg.includes("535"))) {
          smtpError = "Gmail SMTP rejected credentials: A 16-character App Password is required from myaccount.google.com/apppasswords.";
        } else {
          smtpError = rawMsg;
        }
      }
    } else {
      smtpOk = true;
    }

    return NextResponse.json({
      success: imapOk && smtpOk,
      imap: { ok: imapOk, error: imapError },
      smtp: { ok: smtpOk, error: smtpError },
    });
  } catch (error: any) {
    console.error("Connection test error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
