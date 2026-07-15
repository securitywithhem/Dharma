// Phase 9 Part 3 — public API key generation, hashing, and verification.
//
// Third-party integrations authenticate with a bearer API key (never a
// NextAuth session cookie). Only the SHA-256 hash is stored — same
// store-hashed-never-plaintext rule as Phase 9 Part 1 endpoint tokens and the
// Phase 8 SCIM token. keyPrefix is a non-secret identifier for the UI.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKey, PrismaClient } from "@prisma/client";

const KEY_PREFIX = "dhm_";

/** Canonical scope registry — every /api/v1 route requires one of these. */
export const API_SCOPES = [
  "controls:read",
  "evidence:read",
  "evidence:write",
  "vulnerabilities:read",
  "reports:read",
  "frameworks:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Returns the plaintext key and its display prefix. Plaintext is shown once. */
export function generateApiKey(): { token: string; keyPrefix: string } {
  const token = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  // e.g. "dhm_a1b2c3d4" — enough to disambiguate keys in the UI without
  // revealing anything secret.
  return { token, keyPrefix: token.slice(0, 12) };
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class ApiKeyError extends Error {
  constructor(
    message: string,
    public readonly reason: "MALFORMED" | "NOT_FOUND" | "REVOKED",
  ) {
    super(message);
    this.name = "ApiKeyError";
  }
}

/**
 * Resolves a bearer token to its ApiKey. Throws ApiKeyError for a
 * malformed / unknown / revoked key — the route maps every failure to a flat
 * 401 (no enumeration oracle). Lookup is by the indexed unique hash; the
 * constant-time compare is defense-in-depth.
 */
export async function verifyApiKey(
  prisma: PrismaClient,
  token: string | undefined | null,
): Promise<ApiKey> {
  if (!token || !token.startsWith(KEY_PREFIX)) {
    throw new ApiKeyError("Malformed API key.", "MALFORMED");
  }

  const keyHash = hashApiKey(token);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!apiKey) throw new ApiKeyError("Unknown API key.", "NOT_FOUND");

  const presented = Buffer.from(keyHash, "hex");
  const stored = Buffer.from(apiKey.keyHash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    throw new ApiKeyError("Unknown API key.", "NOT_FOUND");
  }

  if (apiKey.revokedAt) throw new ApiKeyError("API key has been revoked.", "REVOKED");

  return apiKey;
}

/** True when the key's scopes include the required scope. */
export function keyHasScope(apiKey: Pick<ApiKey, "scopes">, required: ApiScope): boolean {
  const scopes = Array.isArray(apiKey.scopes) ? (apiKey.scopes as unknown[]) : [];
  return scopes.includes(required);
}
