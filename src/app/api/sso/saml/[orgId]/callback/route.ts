// Phase 8 Part 1 — SAML Assertion Consumer Service (ACS) endpoint.
// The IdP POSTs the signed SAMLResponse here; validation (signature,
// audience, expiry, replay bounds) happens in saml.service.ts.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import {
  handleSamlCallback,
  SamlConfigError,
  SamlValidationError,
} from "@/server/services/sso/saml.service";
import { createSsoSessionRedirect } from "@/server/services/sso/session";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: { orgId: string } },
) {
  try {
    const form = await request.formData();
    const samlResponse = form.get("SAMLResponse");
    if (typeof samlResponse !== "string" || samlResponse.length === 0) {
      return NextResponse.json({ error: "Missing SAMLResponse." }, { status: 400 });
    }
    const relayState = form.get("RelayState");
    const redirectPath =
      typeof relayState === "string" &&
      relayState.startsWith("/") &&
      !relayState.startsWith("//")
        ? relayState
        : "/dashboard";

    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const user = await handleSamlCallback(
      prisma,
      params.orgId,
      samlResponse,
      ipAddress,
    );
    return await createSsoSessionRedirect(user, redirectPath);
  } catch (error) {
    // Validation details are logged server-side only; the browser gets a
    // generic failure page (no assertion contents, no cert material).
    logger.warn({ err: error, orgId: params.orgId }, "SAML callback rejected");
    if (error instanceof SamlConfigError || error instanceof SamlValidationError) {
      return NextResponse.redirect(
        new URL("/auth/error?error=SsoFailed", request.url),
        303,
      );
    }
    return NextResponse.json({ error: "SSO login failed." }, { status: 500 });
  }
}
