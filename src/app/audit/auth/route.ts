import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import {
  AUDITOR_COOKIE_NAME,
  AUDITOR_EXCHANGE_PARAM,
  generateAuditorSessionToken,
  hashAuditorToken,
} from "@/server/auditor-access";

export async function GET(req: NextRequest) {
  const exchangeCode = req.nextUrl.searchParams.get(AUDITOR_EXCHANGE_PARAM);

  if (!exchangeCode) {
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }

  const tokenHash = hashAuditorToken(exchangeCode);
  const now = new Date();

  const auditorAccess = await prisma.auditorAccess.findFirst({
    where: {
      tokenHash,
      isActive: true,
      exchangedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      organizationId: true,
      expiresAt: true,
    },
  });

  if (!auditorAccess) {
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }

  const sessionToken = generateAuditorSessionToken();
  const sessionTokenHash = hashAuditorToken(sessionToken);
  const updated = await prisma.auditorAccess.updateMany({
    where: {
      id: auditorAccess.id,
      tokenHash,
      exchangedAt: null,
    },
    data: {
      tokenHash: null,
      sessionTokenHash,
      exchangedAt: now,
    },
  });

  if (updated.count !== 1) {
    return NextResponse.redirect(new URL("/audit/portal", req.url));
  }

  const response = NextResponse.redirect(new URL("/audit/portal", req.url));
  response.cookies.set({
    name: AUDITOR_COOKIE_NAME,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    sameSite: "lax",
    expires: auditorAccess.expiresAt,
  });

  return response;
}
