import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return new NextResponse("Missing url parameter", { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return new NextResponse("Invalid URL", { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return new NextResponse("Invalid protocol", { status: 400 });
    }

    // Block private/internal IPs to prevent SSRF
    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.2") ||
      hostname.startsWith("172.3") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return new NextResponse("Forbidden target address", { status: 403 });
    }

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "OmniMail-ImageProxy/1.0",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return new NextResponse("Failed to fetch image", { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    return new NextResponse("Error proxying image", { status: 500 });
  }
}
