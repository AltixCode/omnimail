import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getOrCreateDefaultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/**
 * Normalizes an email address or domain.
 * Extracts email from formatted strings like "John Doe <john@example.com>" -> "john@example.com"
 */
function normalizeSenderAddress(raw: string): string {
  let cleaned = raw.trim().toLowerCase();
  const match = cleaned.match(/<([^>]+)>/);
  if (match && match[1]) {
    cleaned = match[1].trim().toLowerCase();
  }
  return cleaned;
}

// GET /api/settings/trusted-senders
export async function GET(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const senders = await prisma.trustedSender.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ senders });
  } catch (error: any) {
    console.error("Failed to fetch trusted senders:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch trusted senders" }, { status: 500 });
  }
}

// POST /api/settings/trusted-senders
export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();
    const rawEmail = body?.email;

    if (!rawEmail || typeof rawEmail !== "string" || !rawEmail.trim()) {
      return NextResponse.json({ error: "A valid email address or domain is required" }, { status: 400 });
    }

    const email = normalizeSenderAddress(rawEmail);

    if (!email || (!email.includes("@") && !email.startsWith("."))) {
      return NextResponse.json({ error: "Invalid email address or domain format" }, { status: 400 });
    }

    const sender = await prisma.trustedSender.upsert({
      where: {
        userId_email: {
          userId: user.id,
          email,
        },
      },
      update: {},
      create: {
        userId: user.id,
        email,
      },
    });

    return NextResponse.json({ success: true, sender });
  } catch (error: any) {
    console.error("Failed to add trusted sender:", error);
    return NextResponse.json({ error: error.message || "Failed to add trusted sender" }, { status: 500 });
  }
}

// DELETE /api/settings/trusted-senders
export async function DELETE(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const rawEmail = searchParams.get("email");

    if (!id && !rawEmail) {
      // Also try reading JSON body if available
      try {
        const body = await req.json();
        if (body.id) {
          await prisma.trustedSender.deleteMany({
            where: { id: body.id, userId: user.id },
          });
          return NextResponse.json({ success: true });
        }
        if (body.email) {
          const email = normalizeSenderAddress(body.email);
          await prisma.trustedSender.deleteMany({
            where: { email, userId: user.id },
          });
          return NextResponse.json({ success: true });
        }
      } catch {
        // Body was empty or invalid JSON
      }
      return NextResponse.json({ error: "Sender id or email is required" }, { status: 400 });
    }

    if (id) {
      await prisma.trustedSender.deleteMany({
        where: { id, userId: user.id },
      });
    } else if (rawEmail) {
      const email = normalizeSenderAddress(rawEmail);
      await prisma.trustedSender.deleteMany({
        where: { email, userId: user.id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to delete trusted sender:", error);
    return NextResponse.json({ error: error.message || "Failed to delete trusted sender" }, { status: 500 });
  }
}
