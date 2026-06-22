import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse("Invalid or missing token", { status: 400 });
  }

  const auditorAccess = await prisma.auditorAccess.findUnique({
    where: { token },
  });

  if (!auditorAccess || !auditorAccess.isActive || auditorAccess.expiresAt < new Date()) {
    return new NextResponse("Token is invalid or has expired", { status: 401 });
  }

  const response = NextResponse.redirect(new URL("/audit/portal", req.url));

  // Set HTTP-only cookie
  response.cookies.set({
    name: "dharma_auditor_token",
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: auditorAccess.expiresAt,
  });

  return response;
}
