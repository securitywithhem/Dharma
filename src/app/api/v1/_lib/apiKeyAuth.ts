// Phase 9 Part 3 — public API auth + request wrapper.
//
// The highest-risk surface in the phase: the first fully external-facing
// read/WRITE path. Every /api/v1 handler runs through `withApiKey`, which:
//   1. verifies the bearer key (hash compare) — flat 401 on any failure
//   2. enforces the route's required scope — 403 if absent
//   3. rate-limits PER API KEY (not per org) so one integration's burst
//      can't throttle another in the same org
//   4. updates lastUsedAt fire-and-forget (never blocks the response)
//   5. audits every call (action "API_REQUEST" with route/keyId/org)
// The org is ALWAYS taken from the key (apiKey.organizationId) and passed to
// the handler — a client-supplied orgId is never trusted.
import { NextRequest, NextResponse } from "next/server";
import type { ApiKey } from "@prisma/client";
import { prisma } from "@/server/db";
import { checkRateLimit } from "@/server/lib/rateLimit";
import { verifyApiKey, keyHasScope, ApiKeyError, type ApiScope } from "@/server/lib/apiKey";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { logger } from "@/lib/logger";

/** Per-key limit: 120 requests/minute. */
const API_RATE_LIMIT = 120;
const API_RATE_WINDOW_MS = 60_000;

export interface ApiContext {
  organizationId: string;
  apiKey: ApiKey;
}

export function apiError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

function bearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Wraps a v1 route handler with auth, scope, rate limit, and audit. The
 * handler receives an ApiContext whose organizationId is authoritative.
 */
export async function withApiKey(
  request: NextRequest,
  requiredScope: ApiScope,
  handler: (ctx: ApiContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  // 1. Authenticate
  let apiKey: ApiKey;
  try {
    apiKey = await verifyApiKey(prisma, bearer(request));
  } catch (error) {
    if (error instanceof ApiKeyError) return apiError(401, "Unauthorized.");
    logger.error({ err: error }, "api key verification failed unexpectedly");
    return apiError(500, "Internal error.");
  }

  // 2. Scope check
  if (!keyHasScope(apiKey, requiredScope)) {
    return apiError(403, `Missing required scope: ${requiredScope}`);
  }

  // 3. Rate limit per key
  try {
    checkRateLimit(`api-key:${apiKey.id}`, API_RATE_LIMIT, API_RATE_WINDOW_MS);
  } catch {
    return apiError(429, "Rate limit exceeded.");
  }

  // 4. lastUsedAt — fire-and-forget, must not delay the response.
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  // 5. Audit the request (org taken from the key, never the client).
  const url = new URL(request.url);
  void emitAuditEvent(prisma, {
    organizationId: apiKey.organizationId,
    userId: null,
    action: "API_REQUEST",
    entity: "ApiKey",
    entityId: apiKey.id,
    changes: {
      actor: "api-key",
      method: request.method,
      route: url.pathname,
      scope: requiredScope,
    },
  }).catch(() => undefined);

  try {
    return await handler({ organizationId: apiKey.organizationId, apiKey });
  } catch (error) {
    logger.error({ err: error, route: url.pathname }, "api/v1 handler failed");
    return apiError(500, "Internal error.");
  }
}

/** Shared cursor-pagination parser for list endpoints. */
export function parseListQuery(request: NextRequest, maxLimit = 100) {
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(1, Number(params.get("limit")) || 50), maxLimit);
  return { limit, cursor: params.get("cursor") || undefined };
}

/** Uniform list envelope: { data, nextCursor }. */
export function listResponse<T>(items: T[], limit: number, cursorOf: (item: T) => string) {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  return NextResponse.json({
    data,
    nextCursor: hasMore ? cursorOf(data[data.length - 1]!) : null,
  });
}
