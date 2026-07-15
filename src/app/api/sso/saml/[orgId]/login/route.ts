// Phase 8 Part 1 — SAML login initiation (SP-initiated flow).
// Not in the original task brief's route list, but required: something has
// to produce the AuthnRequest redirect to the IdP. Flagged as an addition.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { buildSamlLoginUrl, SamlConfigError } from "@/server/services/sso/saml.service";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  try {
    // RelayState is restricted to same-app paths — never an absolute URL —
    // so the IdP round-trip cannot become an open redirect.
    const requested = request.nextUrl.searchParams.get("returnTo") ?? "/dashboard";
    const relayState = requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";
    const url = await buildSamlLoginUrl(prisma, params.orgId, relayState);
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof SamlConfigError) {
      return NextResponse.json(
        { error: "SAML is not configured for this organization." },
        { status: 404 },
      );
    }
    logger.error({ err: error, orgId: params.orgId }, "SAML login initiation failed");
    return NextResponse.redirect(new URL("/auth/error?error=SsoFailed", request.url));
  }
}
