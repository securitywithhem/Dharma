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
import {
  SESSION_ISSUED_AT_CLAIM,
  SESSION_MAX_AGE_SECONDS,
  nowSessionIssuedAt,
} from "@/server/lib/sessionPolicy";

// GH #22 — the lifetime used to be a local literal here with a "match
// authOptions.session.maxAge" comment. It did not match after #22 shortened the
// NextAuth side, and nothing would have caught that: this file mints its own
// JWT and never reads authOptions. Both now import the same constant.

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
      // GH #22 — without this, an SSO-minted session would carry no origin
      // stamp and the revocation switch would fail it closed on the very next
      // request. The SSO path is the one enterprise buyers actually use, so it
      // must be stamped here as well as in the NextAuth `jwt` callback.
      [SESSION_ISSUED_AT_CLAIM]: nowSessionIssuedAt(),
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
