import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

async function testPurelymail() {
  console.log("Testing Purelymail IMAP & SMTP...");
  const email = "qa@itsata.com";
  const pass = "kjsb5%$#tyewkjbh397%^&";

  // 1. IMAP Test
  console.log("Connecting to imap.purelymail.com:993...");
  const client = new ImapFlow({
    host: "imap.purelymail.com",
    port: 993,
    secure: true,
    auth: {
      user: email,
      pass: pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    console.log("✓ IMAP Connected successfully!");
    const mailboxes = await client.list();
    console.log("✓ Mailboxes found:", mailboxes.map(m => m.path).join(", "));
    await client.logout();
  } catch (err: any) {
    console.error("✗ IMAP Connection failed:", err.message);
  }

  // 2. SMTP Test
  console.log("Verifying SMTP smtp.purelymail.com:465...");
  const transporter = nodemailer.createTransport({
    host: "smtp.purelymail.com",
    port: 465,
    secure: true,
    auth: {
      user: email,
      pass: pass,
    },
  });

  try {
    const verified = await transporter.verify();
    console.log("✓ SMTP Transporter verified successfully:", verified);
  } catch (err: any) {
    console.error("✗ SMTP verification failed:", err.message);
  }
}

testPurelymail().catch(console.error);
