import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const LIMIT = 150; // max requests per minute
const WINDOW = 60 * 1000; // 1 minute in ms

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const limitInfo = rateLimitMap.get(ip);

  if (!limitInfo) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW });
    return false;
  }

  if (now > limitInfo.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW });
    return false;
  }

  limitInfo.count += 1;
  if (limitInfo.count > LIMIT) {
    return true;
  }

  return false;
}

// Clean up expired entries every 2 minutes to prevent memory leaks
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, info] of rateLimitMap.entries()) {
      if (now > info.resetTime) {
        rateLimitMap.delete(ip);
      }
    }
  }, 2 * 60 * 1000);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Rate Limiting for API routes
  if (pathname.startsWith("/api") || pathname.startsWith("/trpc")) {
    const ip = req.ip ?? req.headers.get("x-forwarded-for") ?? "unknown";
    if (isRateLimited(ip)) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  }

  // 2. Auth protection for dashboard
  if (pathname.startsWith("/dashboard")) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const signInUrl = new URL("/auth/signin", req.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // 3. Apply security headers to response
  const response = NextResponse.next();
  
  // Set Helmet-equivalent security headers
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http://localhost:9000 http://127.0.0.1:9000; frame-ancestors 'none'; object-src 'none';"
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Download-Options", "noopen");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - static files (_next/static)
     * - images (_next/image)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

