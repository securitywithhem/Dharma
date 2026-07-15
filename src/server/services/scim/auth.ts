// Phase 8 Part 1 — SCIM bearer-token authentication.
//
// SCIM clients (Okta / Azure AD) send `Authorization: Bearer <token>` to
// /api/scim/v2/[orgId]/*. The token is validated against the SHA-256 hash
// stored on that org's OrganizationSettings — the org in the URL is the only
// org the token can ever match, so a leaked org-A token is useless against
// org B (tenant-isolation tests cover this).
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";

export type ScimAuthResult =
  | { ok: true; organizationId: string }
  | { ok: false; response: NextResponse };

export function scimError(
  status: number,
  detail: string,
  scimType?: string,
): NextResponse {
  return NextResponse.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    },
    { status, headers: { "content-type": "application/scim+json" } },
  );
}

export async function authenticateScimRequest(
  prisma: PrismaClient,
  request: Request,
  organizationId: string,
): Promise<ScimAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return {
      ok: false,
      response: scimError(401, "Missing or malformed Authorization header."),
    };
  }

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { scimEnabled: true, scimTokenHash: true },
  });

  if (!settings?.scimEnabled || !settings.scimTokenHash) {
    return {
      ok: false,
      response: scimError(401, "SCIM provisioning is not enabled for this organization."),
    };
  }

  const presented = createHash("sha256").update(token).digest();
  const stored = Buffer.from(settings.scimTokenHash, "hex");
  const valid =
    presented.length === stored.length && timingSafeEqual(presented, stored);

  if (!valid) {
    return { ok: false, response: scimError(401, "Invalid bearer token.") };
  }

  return { ok: true, organizationId };
}
