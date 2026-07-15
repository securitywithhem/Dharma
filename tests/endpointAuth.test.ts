// Phase 9 Part 1 — unit tests for endpoint agent auth + stale/mapping logic.
// Pure/near-pure units: token gen/hash/verify, rate limit, staleness
// threshold, and the check→control fuzzy-mapping fallback.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createHash } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import {
  generateEnrollmentToken,
  hashEndpointToken,
  verifyEndpointToken,
  enforceHeartbeatRateLimit,
  EndpointAuthError,
} from "@/server/lib/endpointAuth";
import { isStale, STALE_THRESHOLD_MS } from "@/server/queue/workers/endpointStaleSweepWorker";
import { mapCheckToControl } from "@/server/lib/endpointCheckControlMap";

const prisma = new PrismaClient();

describe("endpoint token generation & hashing", () => {
  it("generates a prefixed, unique, high-entropy token", () => {
    const a = generateEnrollmentToken();
    const b = generateEnrollmentToken();
    expect(a).toMatch(/^dhep_[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically with SHA-256 (never stores plaintext)", () => {
    const token = generateEnrollmentToken();
    expect(hashEndpointToken(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    // Hash is not reversible to / does not contain the token.
    expect(hashEndpointToken(token)).not.toContain(token);
  });
});

describe("verifyEndpointToken", () => {
  let orgId: string;
  let token: string;
  let endpointId: string;
  let revokedToken: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `EpAuthOrg ${Date.now()}-${Math.random()}` },
    });
    orgId = org.id;
    token = generateEnrollmentToken();
    const endpoint = await prisma.endpoint.create({
      data: {
        organizationId: orgId,
        hostname: "unit-host",
        os: "macOS",
        osVersion: "14.5",
        agentVersion: "0.1.0",
        enrollmentTokenHash: hashEndpointToken(token),
      },
    });
    endpointId = endpoint.id;

    revokedToken = generateEnrollmentToken();
    await prisma.endpoint.create({
      data: {
        organizationId: orgId,
        hostname: "revoked-host",
        os: "linux",
        osVersion: "1",
        agentVersion: "0.1.0",
        enrollmentTokenHash: hashEndpointToken(revokedToken),
        status: "REVOKED",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("resolves a valid token to its endpoint", async () => {
    const endpoint = await verifyEndpointToken(prisma, token);
    expect(endpoint.id).toBe(endpointId);
    expect(endpoint.organizationId).toBe(orgId);
  });

  it("rejects a malformed token (wrong prefix)", async () => {
    await expect(verifyEndpointToken(prisma, "nope")).rejects.toMatchObject({
      reason: "MALFORMED",
    });
    await expect(verifyEndpointToken(prisma, undefined)).rejects.toBeInstanceOf(
      EndpointAuthError,
    );
  });

  it("rejects an unknown (well-formed) token", async () => {
    await expect(
      verifyEndpointToken(prisma, generateEnrollmentToken()),
    ).rejects.toMatchObject({ reason: "NOT_FOUND" });
  });

  it("rejects a revoked endpoint's token", async () => {
    await expect(verifyEndpointToken(prisma, revokedToken)).rejects.toMatchObject({
      reason: "REVOKED",
    });
  });
});

describe("enforceHeartbeatRateLimit", () => {
  it("allows up to the cap then throws TOO_MANY_REQUESTS", () => {
    const id = `rl-${Date.now()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(() => enforceHeartbeatRateLimit(id, 3)).not.toThrow();
    }
    expect(() => enforceHeartbeatRateLimit(id, 3)).toThrow(/Too many/i);
  });

  it("is keyed per endpoint — one endpoint's flood does not affect another", () => {
    const a = `rl-a-${Date.now()}`;
    const b = `rl-b-${Date.now()}`;
    enforceHeartbeatRateLimit(a, 1);
    expect(() => enforceHeartbeatRateLimit(a, 1)).toThrow();
    // Different endpoint id still has its full budget.
    expect(() => enforceHeartbeatRateLimit(b, 1)).not.toThrow();
  });
});

describe("isStale threshold logic", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("is not stale when last heartbeat is within the window", () => {
    const recent = new Date(now.getTime() - (STALE_THRESHOLD_MS - 60_000));
    expect(isStale(recent, now)).toBe(false);
  });

  it("is stale when last heartbeat is older than the window", () => {
    const old = new Date(now.getTime() - (STALE_THRESHOLD_MS + 60_000));
    expect(isStale(old, now)).toBe(true);
  });

  it("never-heartbeated endpoints are not stale (they stay PENDING)", () => {
    expect(isStale(null, now)).toBe(false);
  });
});

describe("mapCheckToControl fuzzy fallback", () => {
  let orgId: string;
  let frameworkId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `MapOrg ${Date.now()}-${Math.random()}` },
    });
    orgId = org.id;
    const framework = await prisma.framework.create({
      data: { organizationId: orgId, name: `FW ${Date.now()}` },
    });
    frameworkId = framework.id;
    await prisma.control.create({
      data: {
        frameworkId,
        domain: "Cryptography",
        title: "Encryption at rest for all storage",
        description: "All disks encrypted.",
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  it("maps disk_encryption to a control whose title matches the keyword", async () => {
    const controlId = await mapCheckToControl(prisma, orgId, "disk_encryption");
    expect(controlId).not.toBeNull();
  });

  it("returns null for a checkType with no matching control (unmapped)", async () => {
    // No control mentions firewall in this org.
    const controlId = await mapCheckToControl(prisma, orgId, "firewall_status");
    expect(controlId).toBeNull();
  });

  it("returns null for an unknown checkType", async () => {
    expect(await mapCheckToControl(prisma, orgId, "not_a_real_check")).toBeNull();
  });

  it("never maps onto another org's control (org-scoped)", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: `MapOtherOrg ${Date.now()}-${Math.random()}` },
    });
    // otherOrg has NO controls → disk_encryption must be unmapped for it,
    // even though orgId has a matching control.
    const controlId = await mapCheckToControl(prisma, otherOrg.id, "disk_encryption");
    expect(controlId).toBeNull();
    await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => undefined);
  });
});
