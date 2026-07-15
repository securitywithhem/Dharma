// Phase 8 Part 1 — OIDC redirect URI. Exchanges the code (PKCE-verified,
// state/nonce-checked against the encrypted transaction cookie) and mints
// the session.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import {
  handleOidcCallback,
  OidcConfigError,
  OidcValidationError,
  OIDC_TX_COOKIE,
} from "@/server/services/sso/oidc.service";
import { createSsoSessionRedirect } from "@/server/services/sso/session";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  try {
    const txCookie = request.cookies.get(OIDC_TX_COOKIE)?.value;
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const user = await handleOidcCallback(
      prisma,
      params.orgId,
      request.nextUrl,
      txCookie,
      ipAddress,
    );
    const response = await createSsoSessionRedirect(user);
    response.cookies.delete(OIDC_TX_COOKIE);
    return response;
  } catch (error) {
    logger.warn({ err: error, orgId: params.orgId }, "OIDC callback rejected");
    if (error instanceof OidcConfigError || error instanceof OidcValidationError) {
      return NextResponse.redirect(
        new URL("/auth/error?error=SsoFailed", request.url),
        303,
      );
    }
    return NextResponse.json({ error: "SSO login failed." }, { status: 500 });
  }
}
