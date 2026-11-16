import { NextResponse, type NextRequest } from "next/server";
import { apiAccess } from "@/lib/api-guard";
import { COOKIE_NAME } from "@/lib/session-token";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

// Next.js 16 renamed middleware to proxy; it runs on the Node.js runtime, so
// the session signature can be verified here with node:crypto.
export function proxy(req: NextRequest) {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS" && req.nextUrl.pathname.startsWith("/api/")) {
    return new NextResponse(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
    });
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    const decision = apiAccess({
      pathname: req.nextUrl.pathname,
      method: req.method,
      cookieToken: req.cookies.get(COOKIE_NAME)?.value,
      authorization: req.headers.get("authorization"),
    });
    if (decision === "deny") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
    }
  }

  const response = NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  }

  return response;
}

export const config = {
  matcher: "/api/:path*",
};
