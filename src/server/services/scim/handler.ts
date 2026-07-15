// Phase 8 Part 1 — shared wrapper for SCIM route handlers: bearer auth,
// SCIM-shaped error responses, and common query-param parsing.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { env } from "@/env";
import { authenticateScimRequest, scimError } from "./auth";
import { ScimRequestError } from "./scim.service";
import { logger } from "@/lib/logger";

export function scimBaseUrl(organizationId: string) {
  return `${env.NEXTAUTH_URL}/api/scim/v2/${organizationId}`;
}

export function scimJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": "application/scim+json" },
  });
}

export function parseListParams(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return {
    filter: params.get("filter"),
    startIndex: Math.max(1, Number(params.get("startIndex")) || 1),
    count: Math.max(0, Number(params.get("count")) || 100),
  };
}

/**
 * Authenticates the request against the org in the URL, then runs the
 * handler. ScimRequestErrors become SCIM error payloads; anything else is a
 * logged 500 with no internals leaked (and never the bearer token).
 */
export async function withScimAuth(
  request: NextRequest,
  organizationId: string,
  handler: (ctx: {
    prisma: typeof prisma;
    organizationId: string;
    baseUrl: string;
  }) => Promise<NextResponse>,
): Promise<NextResponse> {
  const auth = await authenticateScimRequest(prisma, request, organizationId);
  if (!auth.ok) return auth.response;

  try {
    return await handler({
      prisma,
      organizationId,
      baseUrl: scimBaseUrl(organizationId),
    });
  } catch (error) {
    if (error instanceof ScimRequestError) {
      return scimError(error.status, error.message, error.scimType);
    }
    logger.error(
      { err: error, orgId: organizationId, path: request.nextUrl.pathname },
      "SCIM handler failed",
    );
    return scimError(500, "Internal error.");
  }
}

export async function readScimBody<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ScimRequestError(400, "Request body is not valid JSON.", "invalidSyntax");
  }
}
