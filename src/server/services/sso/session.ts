// Phase 8 Part 1 — mints a NextAuth-compatible session after a validated
// SSO assertion.
//
// The app uses NextAuth v4 with strategy "jwt"; enterprise SSO callbacks
// live outside NextAuth's provider flow, so we encode the same JWT NextAuth
// itself would produce (next-auth/jwt `encode`, same NEXTAUTH_SECRET) and
// set it on the standard session cookie. Existing credential/OAuth flows
// are untouched — this is an additional provider path, not a replacement.
import { encode } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { Role, User } from "@prisma/client";
import { env } from "@/env";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // match authOptions.session.maxAge

function usesSecureCookies() {
  return env.NEXTAUTH_URL.startsWith("https://");
}

export function sessionCookieName() {
  return usesSecureCookies()
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

export async function createSsoSessionRedirect(
  user: Pick<User, "id" | "email" | "name" | "role" | "organizationId">,
  redirectPath = "/dashboard",
): Promise<NextResponse> {
  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      organizationId: user.organizationId,
    },
    secret: env.NEXTAUTH_SECRET,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  const response = NextResponse.redirect(
    new URL(redirectPath, env.NEXTAUTH_URL),
    // 303: SAML ACS is a POST — the redirect after it must switch to GET.
    303,
  );
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: usesSecureCookies(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
