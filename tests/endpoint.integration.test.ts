// Phase 9 Part 1 — endpoint agent integration tests.
//
// Exercises the full chain against the real DB: enroll (tRPC) → heartbeat
// (REST route) → postprocess worker → EndpointCheck.controlId + Evidence
// (source "agent") + AuditLog. Asserts tenant isolation end-to-end: an org A
// token can never write into org B, and mapping never crosses orgs.
//
// The postprocess queue is mocked (no Redis under jest); the worker processor
// is invoked directly with the checkIds the heartbeat route inserted.
// AUDIT_WRITER_MODE=sync (envs/.env.test) makes emitAuditEvent write inline.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { PrismaClient, Role } from "@prisma/client";

const mockEnqueue = jest.fn<any>().mockResolvedValue(undefined);
jest.mock("@/server/queue/endpointQueue", () => ({
  enqueueEndpointCheckPostprocess: (...args: unknown[]) => mockEnqueue(...args),
}));

// MinIO putObject is mocked so the worker's evidence-object write doesn't
// require a live bucket; the Evidence ROW creation is still real.
const mockPutObject = jest.fn<any>().mockResolvedValue(undefined);
jest.mock("@/server/minio", () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
}));

// eslint-disable-next-line import/first
import { POST as heartbeatPOST } from "@/app/api/agent/heartbeat/route";
// eslint-disable-next-line import/first
import { createEndpointCheckPostprocessProcessor } from "@/server/queue/workers/endpointCheckPostprocessWorker";
// eslint-disable-next-line import/first
import { createEndpointStaleSweepProcessor } from "@/server/queue/workers/endpointStaleSweepWorker";
// eslint-disable-next-line import/first
import { endpointRouter } from "@/server/routers/endpoint";
// eslint-disable-next-line import/first
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
// eslint-disable-next-line import/first
import { hashEndpointToken } from "@/server/lib/endpointAuth";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ endpoint: endpointRouter });

function adminCaller(orgId: string, userId: string) {
  return createCallerFactory(testRouter)({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "a@a.test", name: "A", organizationId: orgId, role: Role.ADMIN },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

function heartbeatRequest(token: string, body: unknown) {
  return new NextRequest("http://localhost:3000/api/agent/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Seeded = { orgId: string; adminId: string; controlId: string };

async function seedOrg(label: string): Promise<Seeded> {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const admin = await prisma.user.create({
    data: { email: `${label}-${Date.now()}@t.test`, organizationId: org.id, role: Role.ADMIN },
  });
  const framework = await prisma.framework.create({
    data: { organizationId: org.id, name: `FW ${label} ${Date.now()}` },
  });
  const control = await prisma.control.create({
    data: {
      frameworkId: framework.id,
      domain: "Cryptography",
      title: "Disk encryption at rest",
      description: "Full disk encryption required.",
    },
  });
  return { orgId: org.id, adminId: admin.id, controlId: control.id };
}

let orgA: Seeded;
let orgB: Seeded;

beforeAll(async () => {
  orgA = await seedOrg("EpIntA");
  orgB = await seedOrg("EpIntB");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgA.orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgB.orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("enroll → heartbeat → postprocess → evidence + audit", () => {
  it("runs the full chain and maps a check to a control with agent evidence", async () => {
    jest.clearAllMocks();
    const caller = adminCaller(orgA.orgId, orgA.adminId);

    // 1. Enroll (returns one-time token; only the hash is stored).
    const { endpoint, enrollmentToken, installCommand } = await caller.endpoint.enroll({
      hostname: "laptop-1",
      os: "macOS",
      osVersion: "14.5",
      agentVersion: "0.1.0",
    });
    expect(enrollmentToken).toMatch(/^dhep_/);
    expect(installCommand).toContain(enrollmentToken);
    const stored = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });
    expect(stored?.status).toBe("PENDING");
    expect(stored?.enrollmentTokenHash).toBe(hashEndpointToken(enrollmentToken));
    // ENDPOINT_ENROLLED audit, without the token in it.
    const enrollAudit = await prisma.auditLog.findFirst({
      where: { organizationId: orgA.orgId, action: "ENDPOINT_ENROLLED", entityId: endpoint.id },
    });
    expect(enrollAudit).not.toBeNull();
    expect(JSON.stringify(enrollAudit)).not.toContain(enrollmentToken);

    // 2. Heartbeat with two checks: one mappable (disk_encryption), one not.
    const response = await heartbeatPOST(
      heartbeatRequest(enrollmentToken, {
        hostname: "laptop-1",
        agentVersion: "0.1.1",
        checks: [
          { checkType: "disk_encryption", result: { pass: true, raw: { fileVault: "on" } } },
          { checkType: "firewall_status", result: { pass: false } },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, accepted: 2 });

    // Status flipped PENDING → ACTIVE; agentVersion updated; heartbeat stamped.
    const active = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });
    expect(active?.status).toBe("ACTIVE");
    expect(active?.agentVersion).toBe("0.1.1");
    expect(active?.lastHeartbeatAt).not.toBeNull();

    // Raw checks persisted by the route (read them back to drive the worker —
    // exactly the payload the route enqueues).
    const rawChecks = await prisma.endpointCheck.findMany({
      where: { endpointId: endpoint.id },
    });
    expect(rawChecks).toHaveLength(2);
    expect(rawChecks.every((c) => c.organizationId === orgA.orgId)).toBe(true);
    const enqueued = {
      endpointId: endpoint.id,
      organizationId: orgA.orgId,
      checkIds: rawChecks.map((c) => c.id),
    };

    // 3. Run the postprocess worker on the enqueued job.
    const processor = createEndpointCheckPostprocessProcessor(prisma);
    const result = (await processor({ data: enqueued } as never)) as {
      processed: number;
      mapped: number;
      unmapped: number;
    };
    expect(result).toEqual({ processed: 2, mapped: 1, unmapped: 1 });

    // disk_encryption check now carries the mapped controlId...
    const checks = await prisma.endpointCheck.findMany({
      where: { endpointId: endpoint.id },
      orderBy: { checkType: "asc" },
    });
    const diskCheck = checks.find((c) => c.checkType === "disk_encryption")!;
    const fwCheck = checks.find((c) => c.checkType === "firewall_status")!;
    expect(diskCheck.controlId).toBe(orgA.controlId);
    expect(fwCheck.controlId).toBeNull(); // unmapped

    // ...and produced exactly one agent Evidence row (mapped check only).
    const evidence = await prisma.evidence.findMany({
      where: { organizationId: orgA.orgId, source: "agent" },
    });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].controlId).toBe(orgA.controlId);
    expect(evidence[0].filePath).toContain("agent-evidence");

    // Both checks audited as ENDPOINT_CHECK_INGESTED (mapped + unmapped).
    const ingestAudits = await prisma.auditLog.findMany({
      where: { organizationId: orgA.orgId, action: "ENDPOINT_CHECK_INGESTED" },
    });
    expect(ingestAudits).toHaveLength(2);
  });

  it("rejects an unknown / malformed / revoked token with a flat 401", async () => {
    const bad = await heartbeatPOST(heartbeatRequest("dhep_deadbeef", { checks: [] }));
    expect(bad.status).toBe(401);

    const malformed = await heartbeatPOST(heartbeatRequest("garbage", { checks: [] }));
    expect(malformed.status).toBe(401);

    // Revoke a real endpoint, then its token must 401.
    const caller = adminCaller(orgA.orgId, orgA.adminId);
    const { endpoint, enrollmentToken } = await caller.endpoint.enroll({
      hostname: "to-revoke",
      os: "linux",
      osVersion: "1",
    });
    await caller.endpoint.revoke({ id: endpoint.id });
    const revoked = await heartbeatPOST(heartbeatRequest(enrollmentToken, { checks: [] }));
    expect(revoked.status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("an org A token can never write into org B (org taken from token, not body)", async () => {
    jest.clearAllMocks();
    const callerA = adminCaller(orgA.orgId, orgA.adminId);
    const { endpoint, enrollmentToken } = await callerA.endpoint.enroll({
      hostname: "iso-host",
      os: "macOS",
      osVersion: "14.5",
    });

    // Heartbeat body cannot smuggle another org — there's no org field, and
    // the route derives it from the token. The check must land in org A.
    await heartbeatPOST(
      heartbeatRequest(enrollmentToken, {
        checks: [{ checkType: "disk_encryption", result: { pass: true } }],
      }),
    );
    const checks = await prisma.endpointCheck.findMany({ where: { endpointId: endpoint.id } });
    expect(checks.every((c) => c.organizationId === orgA.orgId)).toBe(true);

    // Run postprocess; the disk_encryption check must map to org A's control,
    // NEVER org B's (both orgs have an identically-titled control).
    const processor = createEndpointCheckPostprocessProcessor(prisma);
    await processor({
      data: { endpointId: endpoint.id, organizationId: orgA.orgId, checkIds: checks.map((c) => c.id) },
    } as never);
    const diskCheck = await prisma.endpointCheck.findFirst({
      where: { endpointId: endpoint.id, checkType: "disk_encryption" },
    });
    expect(diskCheck?.controlId).toBe(orgA.controlId);
    expect(diskCheck?.controlId).not.toBe(orgB.controlId);
  });

  it("org B admin cannot see or revoke org A's endpoint", async () => {
    const callerA = adminCaller(orgA.orgId, orgA.adminId);
    const { endpoint } = await callerA.endpoint.enroll({
      hostname: "a-only",
      os: "linux",
      osVersion: "1",
    });

    const callerB = adminCaller(orgB.orgId, orgB.adminId);
    // Not in org B's list.
    const list = await callerB.endpoint.list({});
    expect(list.items.find((e) => e.id === endpoint.id)).toBeUndefined();
    // Cannot revoke it.
    await expect(callerB.endpoint.revoke({ id: endpoint.id })).rejects.toThrow();
    // Cannot read its checks.
    await expect(
      callerB.endpoint.getChecks({ endpointId: endpoint.id }),
    ).rejects.toThrow();
  });
});

describe("stale sweep", () => {
  it("marks an ACTIVE endpoint STALE after the threshold and audits it", async () => {
    const caller = adminCaller(orgB.orgId, orgB.adminId);
    const { endpoint, enrollmentToken } = await caller.endpoint.enroll({
      hostname: "stale-host",
      os: "linux",
      osVersion: "1",
    });
    // Make it ACTIVE via a heartbeat, then backdate lastHeartbeatAt beyond 48h.
    await heartbeatPOST(heartbeatRequest(enrollmentToken, { checks: [] }));
    await prisma.endpoint.update({
      where: { id: endpoint.id },
      data: { lastHeartbeatAt: new Date(Date.now() - 49 * 60 * 60 * 1000) },
    });

    const swept = (await createEndpointStaleSweepProcessor(prisma)({ data: {} } as never)) as {
      swept: number;
    };
    expect(swept.swept).toBeGreaterThanOrEqual(1);

    const after = await prisma.endpoint.findUnique({ where: { id: endpoint.id } });
    expect(after?.status).toBe("STALE");
    const staleAudit = await prisma.auditLog.findFirst({
      where: { organizationId: orgB.orgId, action: "ENDPOINT_MARKED_STALE", entityId: endpoint.id },
    });
    expect(staleAudit).not.toBeNull();
  });
});
