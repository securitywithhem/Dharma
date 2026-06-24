import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    console.log("[Audit Auth] No token provided in URL");
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }

  // Validate token
  const auditorAccess = await prisma.auditorAccess.findUnique({
    where: { token },
  });

  if (!auditorAccess) {
    console.log(`[Audit Auth] Token not found in DB: ${token}`);
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }
  
  if (auditorAccess.expiresAt < new Date()) {
    console.log(`[Audit Auth] Token expired: ${token}, expiresAt: ${auditorAccess.expiresAt}`);
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }

  console.log(`[Audit Auth] Valid token found: ${token}. Setting cookie!`);

  // Generate the response redirecting to the portal
  const response = NextResponse.redirect(new URL("/audit/portal", req.url));

  // Set HTTP-only cookie using next/headers
  cookies().set({
    name: "dharma_auditor_token",
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    expires: auditorAccess.expiresAt,
  });

  return response;
}
