// Phase 9 Part 1 — endpoint agent authentication.
//
// Endpoints are headless devices, so they authenticate with a per-endpoint
// bearer token rather than a NextAuth session — the same "external credential,
// stored hashed, never in plaintext" posture the TRD mandates for connector
// secrets (2_TRD.md "Security-first"). The token is shown to the operator
// exactly once at enrollment; only its SHA-256 hash is persisted
// (Endpoint.enrollmentTokenHash), mirroring the SCIM-token pattern from
// Phase 8 (OrganizationSettings.scimTokenHash).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Endpoint, PrismaClient } from "@prisma/client";
import { checkRateLimit } from "@/server/lib/rateLimit";

/** Human-recognizable prefix so a leaked token is greppable in logs/secrets scanners. */
const TOKEN_PREFIX = "dhep_";

export function generateEnrollmentToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashEndpointToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class EndpointAuthError extends Error {
  constructor(
    message: string,
    public readonly reason: "MALFORMED" | "NOT_FOUND" | "REVOKED",
  ) {
    super(message);
    this.name = "EndpointAuthError";
  }
}

/**
 * Resolves a bearer token to its Endpoint. Throws EndpointAuthError for a
 * malformed/unknown/revoked token — the caller (heartbeat route) maps every
 * failure to a flat 401 so the response never reveals which of the three it
 * was (no enumeration oracle).
 *
 * Lookup is by the token HASH (an indexed unique column); the constant-time
 * compare is belt-and-suspenders against timing analysis on the hash itself.
 */
export async function verifyEndpointToken(
  prisma: PrismaClient,
  token: string | undefined | null,
): Promise<Endpoint> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) {
    throw new EndpointAuthError("Malformed endpoint token.", "MALFORMED");
  }

  const tokenHash = hashEndpointToken(token);
  const endpoint = await prisma.endpoint.findUnique({
    where: { enrollmentTokenHash: tokenHash },
  });

  if (!endpoint) {
    throw new EndpointAuthError("Unknown endpoint token.", "NOT_FOUND");
  }

  // Defensive constant-time confirmation (the DB lookup already matched the
  // hash, but this guards against any future non-unique lookup path).
  const presented = Buffer.from(tokenHash, "hex");
  const stored = Buffer.from(endpoint.enrollmentTokenHash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    throw new EndpointAuthError("Unknown endpoint token.", "NOT_FOUND");
  }

  if (endpoint.status === "REVOKED") {
    throw new EndpointAuthError("Endpoint has been revoked.", "REVOKED");
  }

  return endpoint;
}

/**
 * Per-endpoint heartbeat rate limit. Reuses the in-process token-bucket
 * limiter (2_TRD.md Performance) keyed by endpoint id, so a single misbehaving
 * or compromised agent can't flood the ingestion pipeline for the whole org.
 * Default: 60 heartbeats/min/endpoint — comfortably above the expected
 * 1-per-few-minutes cadence while still bounding abuse.
 *
 * Throws TRPCError(TOO_MANY_REQUESTS); the REST caller catches it and maps to
 * HTTP 429.
 */
export function enforceHeartbeatRateLimit(
  endpointId: string,
  maxPerMinute = 60,
): void {
  checkRateLimit(`endpoint-heartbeat:${endpointId}`, maxPerMinute, 60_000);
}
