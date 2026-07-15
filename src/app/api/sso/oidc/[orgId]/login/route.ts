// Phase 8 Part 1 — OIDC login initiation (authorization-code + PKCE).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import {
  buildOidcLoginRedirect,
  OidcConfigError,
  OIDC_TX_COOKIE,
} from "@/server/services/sso/oidc.service";
import { env } from "@/env";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  try {
    const { authorizationUrl, txCookieValue, txMaxAge } =
      await buildOidcLoginRedirect(prisma, params.orgId);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(OIDC_TX_COOKIE, txCookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NEXTAUTH_URL.startsWith("https://"),
      path: `/api/sso/oidc/${params.orgId}`,
      maxAge: txMaxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof OidcConfigError) {
      return NextResponse.json(
        { error: "OIDC is not configured for this organization." },
        { status: 404 },
      );
    }
    logger.error({ err: error, orgId: params.orgId }, "OIDC login initiation failed");
    return NextResponse.redirect(new URL("/auth/error?error=SsoFailed", request.url));
  }
}
