// Phase 9 Part 1 — endpoint agent heartbeat ingestion (REST, not tRPC).
//
// Headless agents POST here with their bearer token. To hold heartbeat p95
// under 200ms (2_TRD.md Performance), this route does ONLY the fast, must-be-
// synchronous work:
//   1. verify token → resolve Endpoint + organizationId
//   2. per-endpoint rate limit
//   3. update lastHeartbeatAt, flip PENDING→ACTIVE on first heartbeat
//   4. bulk-insert the raw EndpointCheck rows
//   5. enqueue endpoint-check-postprocess
// The heavy work (control mapping, Evidence creation, per-check AuditLog
// writes) happens in the worker — see endpointCheckPostprocessWorker.ts.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  verifyEndpointToken,
  EndpointAuthError,
  enforceHeartbeatRateLimit,
} from "@/server/lib/endpointAuth";
import { enqueueEndpointCheckPostprocess } from "@/server/queue/endpointQueue";
import { logger } from "@/lib/logger";

const heartbeatSchema = z.object({
  hostname: z.string().trim().min(1).max(255).optional(),
  agentVersion: z.string().trim().min(1).max(32).optional(),
  checks: z
    .array(
      z.object({
        checkType: z.string().trim().min(1).max(64),
        result: z.object({ pass: z.boolean(), raw: z.record(z.unknown()).optional() }),
      }),
    )
    .max(100)
    .default([]),
});

function bearerFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function POST(request: NextRequest) {
  // ── 1. Authenticate ────────────────────────────────────────────────────
  let endpoint;
  try {
    endpoint = await verifyEndpointToken(prisma, bearerFrom(request));
  } catch (error) {
    if (error instanceof EndpointAuthError) {
      // Flat 401 for malformed/unknown/revoked — no enumeration oracle.
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    logger.error({ err: error }, "endpoint heartbeat auth failed unexpectedly");
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }

  // ── 2. Rate limit (per endpoint) ───────────────────────────────────────
  try {
    enforceHeartbeatRateLimit(endpoint.id);
  } catch {
    return NextResponse.json(
      { error: "Too many heartbeats. Slow down." },
      { status: 429 },
    );
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────
  let body;
  try {
    body = heartbeatSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid heartbeat body." }, { status: 400 });
  }

  // ── 4. Update heartbeat + flip PENDING→ACTIVE; insert raw checks ────────
  // organizationId is taken from the token-resolved endpoint, never from the
  // request body — an agent can only ever write into its own org.
  const organizationId = endpoint.organizationId;

  await prisma.endpoint.update({
    where: { id: endpoint.id },
    data: {
      lastHeartbeatAt: new Date(),
      agentVersion: body.agentVersion ?? endpoint.agentVersion,
      // A STALE endpoint that heartbeats again returns to ACTIVE; a REVOKED
      // one never reaches here (verifyEndpointToken rejects it).
      status: "ACTIVE",
    },
  });

  const checkIds: string[] = [];
  if (body.checks.length > 0) {
    // createManyAndReturn keeps this a single round-trip while giving us the
    // ids to hand to the postprocess worker.
    const created = await prisma.endpointCheck.createManyAndReturn({
      data: body.checks.map((check) => ({
        endpointId: endpoint.id,
        organizationId,
        checkType: check.checkType,
        result: check.result as Prisma.InputJsonValue,
      })),
      select: { id: true },
    });
    checkIds.push(...created.map((row) => row.id));
  }

  // ── 5. Enqueue the heavy work; keep the response fast ───────────────────
  if (checkIds.length > 0) {
    try {
      await enqueueEndpointCheckPostprocess({
        endpointId: endpoint.id,
        organizationId,
        checkIds,
      });
    } catch (error) {
      // Raw checks are already persisted; a queue outage must not fail the
      // heartbeat (the agent would just retry and duplicate). Log for repair.
      logger.error(
        { err: error, endpointId: endpoint.id, checkIds },
        "failed to enqueue endpoint-check-postprocess; checks persisted but unmapped",
      );
    }
  }

  return NextResponse.json({ ok: true, accepted: checkIds.length });
}
