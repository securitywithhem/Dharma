import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/server/db";
import { env } from "@/env";
import { Role } from "@prisma/client";

export async function GET(req: NextRequest) {
  // Prevent execution in production unless explicit E2E testing variable is defined
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_E2E_AUTH !== "true") {
    return new NextResponse("Not allowed in production", { status: 403 });
  }

  const email = req.nextUrl.searchParams.get("email") ?? "admin@dharma.local";

  let org = await prisma.organization.findFirst();
  if (!org) {
    try {
      org = await prisma.organization.create({
        data: { name: "Dharma E2E Test Organization" },
      });
    } catch (e) {
      org = await prisma.organization.findFirst();
    }
  }

  // Playwright's fullyParallel mode can run multiple spec files concurrently,
  // each hitting this same login backdoor for the same email — upsert isn't
  // atomic against a true concurrent race (two requests can both see "no
  // row exists" and both attempt to INSERT), so the loser fails with a
  // P2002 unique-constraint error on `email`. Falling back to a plain read
  // in that case is safe here: whichever request won the race already
  // created the row we want.
  let user;
  try {
    user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: "Test Admin User",
        role: Role.ADMIN,
        organizationId: org!.id,
      },
    });
  } catch (e) {
    user = await prisma.user.findUniqueOrThrow({ where: { email } });
  }

  // Ensure at least one framework and control exists for evidence tests
  let framework = await prisma.framework.findFirst({
    where: { organizationId: org!.id },
  });
  if (!framework) {
    framework = await prisma.framework.create({
      data: {
        organizationId: org!.id,
        name: "Test Framework",
        description: "Test Framework",
      },
    });
  }

  let control = await prisma.control.findFirst({
    where: { frameworkId: framework.id },
  });
  if (!control) {
    await prisma.control.create({
      data: {
        frameworkId: framework.id,
        domain: "Access Control",
        title: "Test Control",
        description: "Test Control Description",
      },
    });
  }

  // Structure NextAuth JWT payload
  const token = {
    name: user.name,
    email: user.email,
    picture: user.image,
    sub: user.id,
    role: user.role,
    organizationId: user.organizationId,
  };

  const secret = env.NEXTAUTH_SECRET;
  const encodedToken = await encode({
    token,
    secret,
    maxAge: 30 * 24 * 60 * 60,
  });

  const isSecure = req.nextUrl.protocol === "https:";
  const cookieName = isSecure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  
  const response = NextResponse.redirect(new URL("/dashboard", req.url));
  response.cookies.set({
    name: cookieName,
    value: encodedToken,
    httpOnly: true,
    secure: isSecure,
    path: "/",
    sameSite: "lax",
  });

  return response;
}
