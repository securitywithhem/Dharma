// Settings → Security: the signed-in user's own account security.
//
// SCOPE CONSTRAINT (deliberate, do not "fix" by inventing data):
// NextAuth here runs `session.strategy: "jwt"` (src/server/auth.ts), so no
// Session rows are ever written for the normal login paths — the `Session`
// model exists only because PrismaAdapter declares it. There is therefore no
// server-side list of active sessions to show and no session to revoke.
// There is likewise no MFA/TOTP model anywhere in this schema, and no
// password (auth is Google OAuth + email magic-link only), so "change
// password" and "MFA enrollment" have no backing store either.
//
// What IS real and worth surfacing: which sign-in methods are linked to this
// account (Account rows), and whether the org enforces SSO-only login.
import { decode } from "next-auth/jwt";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";

/**
 * Resolve when the caller's session actually expires.
 *
 * `ctx.session.expires` comes back null on the JWT strategy — NextAuth
 * populates it on the client-side session object, not on the one
 * `getServerSession` hands to a route handler — which is why the Security page
 * rendered a bare dash. The JWT's own `exp` claim is the authoritative answer
 * and is right there in the request cookie, so we read it directly.
 *
 * Returns null (never throws, never guesses) if the cookie is absent or
 * undecodable — a dash is correct when we genuinely do not know.
 */
async function resolveSessionExpiry(headers: Headers): Promise<Date | null> {
  const cookieHeader = headers.get("cookie");
  const secret = process.env.NEXTAUTH_SECRET;
  if (!cookieHeader || !secret) return null;

  // `__Secure-` prefix is used whenever NextAuth issues the cookie over HTTPS.
  for (const name of ["__Secure-next-auth.session-token", "next-auth.session-token"]) {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name.replace(/\./g, "\\.")}=([^;]+)`));
    if (!match) continue;
    try {
      const token = await decode({ token: decodeURIComponent(match[1]), secret });
      if (token?.exp && typeof token.exp === "number") return new Date(token.exp * 1000);
    } catch {
      // A malformed or foreign cookie is not an error worth failing the page over.
    }
  }
  return null;
}

export const userRouter = createTRPCRouter({
  securityOverview: orgProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const organizationId = ctx.session.user.organizationId;

    const [accounts, user, orgSettings, sessionExpires] = await Promise.all([
      ctx.prisma.account.findMany({
        where: { userId },
        // Never select token columns — this feeds a client component.
        select: { id: true, provider: true, type: true },
      }),
      ctx.prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { email: true, emailVerified: true, createdAt: true },
      }),
      ctx.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { ssoEnforced: true },
      }),
      resolveSessionExpiry(ctx.headers),
    ]);

    return {
      email: user?.email ?? ctx.session.user.email ?? null,
      emailVerified: user?.emailVerified ?? null,
      accountCreatedAt: user?.createdAt ?? null,
      role: ctx.session.user.role,
      // Prefer the JWT's `exp` claim; ctx.session.expires is null on this
      // strategy. Falls back so a future move to database sessions still works.
      sessionExpires: sessionExpires ?? ctx.session.expires ?? null,
      signInMethods: accounts,
      // Email magic-link logins leave no Account row, so an empty list still
      // means "email link" rather than "no way to sign in".
      emailLinkEnabled: accounts.length === 0,
      ssoEnforced: orgSettings?.ssoEnforced ?? false,
      // Surfaced so the UI can explain the gap instead of rendering a fake
      // "active sessions" table.
      capabilities: {
        sessionListing: false as const,
        sessionRevocation: false as const,
        mfa: false as const,
        passwordChange: false as const,
      },
    };
  }),
});
