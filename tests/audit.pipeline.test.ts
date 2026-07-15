// Phase 8 Part 2 — audit pipeline tests: canonical writer (sync + async
// enqueue paths, Redis-down fallback), worker processor (chained write,
// graph ingestion, SIEM fan-out), and correlation-chain queries with
// tenant isolation.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";

const mockQueueAdd = jest.fn() as jest.Mock;
jest.mock("@/server/queue/auditEventQueue", () => ({
  AUDIT_EVENT_QUEUE_NAME: "audit-events",
  getAuditEventQueue: () => ({ add: mockQueueAdd }),
}));

const mockEnqueueSiemExport = jest.fn().mockResolvedValue(undefined) as jest.Mock;
jest.mock("@/server/queue/siemExportQueue", () => ({
  SIEM_EXPORT_QUEUE_NAME: "siem-export",
  SIEM_EXPORT_FAILED_QUEUE_NAME: "siem-export-failed",
  enqueueSiemExport: (...args: unknown[]) => mockEnqueueSiemExport(...args),
  siemExportFailedQueue: { add: jest.fn() },
}));

// eslint-disable-next-line import/first
import { emitAuditEvent } from "@/server/services/audit/writer";
// eslint-disable-next-line import/first
import { createAuditEventProcessor } from "@/server/queue/workers/auditEventWorker";
// eslint-disable-next-line import/first
import {
  ingestAuditEventToGraph,
  getAuditEventChain,
} from "@/server/services/audit/graph.service";
// eslint-disable-next-line import/first
import { encryptSiemSecret } from "@/server/lib/crypto/siemVault";

const prisma = new PrismaClient();
let orgId: string;
let otherOrgId: string;
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `AuditPipeOrg ${Date.now()}-${Math.random()}` },
  });
  const other = await prisma.organization.create({
    data: { name: `AuditPipeOrgB ${Date.now()}-${Math.random()}` },
  });
  orgId = org.id;
  otherOrgId = other.id;
  userId = (
    await prisma.user.create({
      data: {
        email: `audit-actor-${Date.now()}@test.com`,
        organizationId: orgId,
        role: Role.ADMIN,
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AUDIT_WRITER_MODE;
});

function eventInput(action: string, entityId = `res-${Date.now()}`) {
  return {
    organizationId: orgId,
    userId,
    action,
    entity: "Control",
    entityId,
    changes: { note: "test" },
  };
}

describe("emitAuditEvent (canonical writer)", () => {
  it("writes synchronously under jest (AUDIT_WRITER_MODE unset)", async () => {
    const input = eventInput("SYNC_WRITE_TEST");
    await emitAuditEvent(prisma, input);
    const row = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "SYNC_WRITE_TEST" },
    });
    expect(row).not.toBeNull();
    expect(row?.currentHash).toBeTruthy();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("enqueues (does not write) in async mode — the request thread never does the chained write", async () => {
    process.env.AUDIT_WRITER_MODE = "async";
    mockQueueAdd.mockResolvedValue({ id: "job-1" });

    const input = eventInput("ASYNC_ENQUEUE_TEST");
    await emitAuditEvent(prisma, input);

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const row = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "ASYNC_ENQUEUE_TEST" },
    });
    expect(row).toBeNull();
  });

  it("falls back to a synchronous write when the queue is down — events are never dropped", async () => {
    process.env.AUDIT_WRITER_MODE = "async";
    mockQueueAdd.mockRejectedValue(new Error("redis down"));

    await emitAuditEvent(prisma, eventInput("FALLBACK_WRITE_TEST"));

    const row = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "FALLBACK_WRITE_TEST" },
    });
    expect(row).not.toBeNull();
  });
});

describe("audit event worker processor", () => {
  it("performs the hash-chained write, feeds the graph, and skips SIEM when unconfigured", async () => {
    const processor = createAuditEventProcessor(prisma);
    const entityId = `worker-res-${Date.now()}`;
    const result = (await processor({
      data: { ...eventInput("WORKER_WRITE_TEST", entityId), emittedAt: new Date().toISOString() },
    } as never)) as { auditLogId: string };

    const row = await prisma.auditLog.findUnique({ where: { id: result.auditLogId } });
    expect(row?.action).toBe("WORKER_WRITE_TEST");

    const eventNode = await prisma.orgGraphNode.findFirst({
      where: {
        organizationId: orgId,
        nodeType: "auditEvent",
        metadata: { path: ["auditLogId"], equals: result.auditLogId },
      },
    });
    expect(eventNode).not.toBeNull();
    expect(mockEnqueueSiemExport).not.toHaveBeenCalled();
  });

  it("fans out to the siem-export queue when the org has a target configured", async () => {
    await prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        siemExportConfig: {
          type: "splunk-hec",
          url: "https://splunk.test:8088",
          tokenEnc: encryptSiemSecret("hec-token"),
          sourcetype: "dharma:audit",
        },
      },
      update: {
        siemExportConfig: {
          type: "splunk-hec",
          url: "https://splunk.test:8088",
          tokenEnc: encryptSiemSecret("hec-token"),
          sourcetype: "dharma:audit",
        },
      },
    });

    const processor = createAuditEventProcessor(prisma);
    const result = (await processor({
      data: { ...eventInput("WORKER_SIEM_TEST"), emittedAt: new Date().toISOString() },
    } as never)) as { auditLogId: string };

    expect(mockEnqueueSiemExport).toHaveBeenCalledWith({
      auditLogId: result.auditLogId,
      organizationId: orgId,
    });
  });
});

describe("audit event correlation chain", () => {
  it("correlates same-actor and same-resource events, org-scoped", async () => {
    const entityId = `chain-res-${Date.now()}`;

    const anchor = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "WORKER_WRITE_TEST" },
      orderBy: { createdAt: "desc" },
    });
    expect(anchor).not.toBeNull();

    // A same-resource event ingested into the graph.
    await emitAuditEvent(prisma, eventInput("CHAIN_RELATED_TEST", anchor!.entityId));
    const relatedRow = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "CHAIN_RELATED_TEST" },
    });
    await ingestAuditEventToGraph(prisma, relatedRow!);

    // A decoy in ANOTHER org touching the same entityId — must never appear.
    const foreign = await prisma.auditLog.create({
      data: {
        organizationId: otherOrgId,
        userId: null,
        action: "FOREIGN_EVENT",
        entity: "Control",
        entityId: anchor!.entityId,
        currentHash: "x",
      },
    });

    const chain = await getAuditEventChain(prisma, orgId, anchor!.id, 2);
    const ids = chain.map((c) => c.auditLog.id);
    expect(ids).toContain(relatedRow!.id);
    expect(ids).not.toContain(foreign.id);
    expect(chain.every((c) => c.auditLog.organizationId === orgId)).toBe(true);

    // Anchor from the wrong org yields nothing.
    expect(await getAuditEventChain(prisma, otherOrgId, anchor!.id, 2)).toEqual([]);
  });
});
