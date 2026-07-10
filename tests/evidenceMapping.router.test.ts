import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { PrismaClient, Role, ConnectorType, ConnectorStatus } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { TRPCError } from "@trpc/server";

// Mock the BullMQ queue module — these are router-logic + real-DB integration
// tests, not a test of BullMQ/Redis itself (that's covered by
// connectorEvidenceWorker.test.ts and the queue helpers' own usage in
// connectorQueue.ts). Mocking keeps this suite fast and infra-independent.
const addOrUpdateRepeatableJob = jest.fn().mockResolvedValue(undefined);
const removeRepeatableJob = jest.fn().mockResolvedValue(undefined);
const enqueueImmediateCollection = jest.fn().mockResolvedValue("job-123");

jest.mock("@/server/queue/connectorQueue", () => ({
  addOrUpdateRepeatableJob: (...args: any[]) => addOrUpdateRepeatableJob(...args),
  removeRepeatableJob: (...args: any[]) => removeRepeatableJob(...args),
  enqueueImmediateCollection: (...args: any[]) => enqueueImmediateCollection(...args),
}));

// Deliberately import only the two routers under test rather than the full
// appRouter: appRouter's import graph pulls in half a dozen *other*
// BullMQ queues (policy, anchor, auditorPackage, classification, legacy
// connector-sync) that each open a real Redis connection at module-import
// time and are unrelated to what this suite is testing — importing all of
// appRouter here previously hung the test run on those unrelated
// connections instead of exercising evidenceMapping/connector logic.
// eslint-disable-next-line import/first
import { evidenceMappingRouter } from "@/server/routers/evidenceMapping";
// eslint-disable-next-line import/first
import { connectorRouter } from "@/server/routers/connector";

const testRouter = createTRPCRouter({
  evidenceMapping: evidenceMappingRouter,
  connector: connectorRouter,
});

const prisma = new PrismaClient();

function createCaller(orgId: string, uid: string, role: Role) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: uid, email: "test@example.com", name: "Test User", organizationId: orgId, role },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

async function seedOrg(label: string) {
  const org = await prisma.organization.create({ data: { name: `${label} ${Date.now()}-${Math.random()}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${Date.now()}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  const framework = await prisma.framework.create({ data: { name: `${label} Framework`, organizationId: org.id } });
  const control = await prisma.control.create({
    data: { frameworkId: framework.id, title: `${label} Control`, domain: "Test", description: "desc" },
  });
  const connector = await prisma.connector.create({
    data: {
      organizationId: org.id,
      type: ConnectorType.AWS,
      name: `${label} AWS`,
      config: "encrypted-blob",
      status: ConnectorStatus.CONNECTED,
    },
  });
  return { org, user, framework, control, connector };
}

describe("evidenceMapping router", () => {
  let orgA: Awaited<ReturnType<typeof seedOrg>>;
  let orgB: Awaited<ReturnType<typeof seedOrg>>;

  beforeAll(async () => {
    orgA = await seedOrg("OrgA");
    orgB = await seedOrg("OrgB");
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgA.org.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: orgB.org.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an unavailable evidenceType", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    await expect(
      caller.evidenceMapping.create({
        connectorId: orgA.connector.id,
        controlId: orgA.control.id,
        evidenceType: "not_a_real_evidence_type",
      }),
    ).rejects.toThrow(/not an available evidence type/);
  });

  it("creates a mapping with the default daily schedule and registers the repeatable job", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const mapping = await caller.evidenceMapping.create({
      connectorId: orgA.connector.id,
      controlId: orgA.control.id,
      evidenceType: "aws_cloudtrail_enabled",
    });

    expect(mapping.schedule).toBe("0 3 * * *");
    expect(addOrUpdateRepeatableJob).toHaveBeenCalledWith(mapping.id, "0 3 * * *");
  });

  it("rejects a malformed cron schedule", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    await expect(
      caller.evidenceMapping.create({
        connectorId: orgA.connector.id,
        controlId: orgA.control.id,
        evidenceType: "aws_cloudtrail_enabled",
        schedule: "not a cron",
      }),
    ).rejects.toThrow();
  });

  it("enforces RBAC — a VIEWER cannot create a mapping", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.VIEWER);
    await expect(
      caller.evidenceMapping.create({
        connectorId: orgA.connector.id,
        controlId: orgA.control.id,
        evidenceType: "aws_cloudtrail_enabled",
      }),
    ).rejects.toThrow();
  });

  it("enforces tenant isolation — org B cannot create a mapping against org A's connector/control", async () => {
    const callerB = createCaller(orgB.org.id, orgB.user.id, Role.ADMIN);
    await expect(
      callerB.evidenceMapping.create({
        connectorId: orgA.connector.id,
        controlId: orgA.control.id,
        evidenceType: "aws_cloudtrail_enabled",
      }),
    ).rejects.toThrow(TRPCError);
  });

  it("enforces tenant isolation — org B cannot list, update, delete, or trigger org A's mapping", async () => {
    const callerA = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const mapping = await callerA.evidenceMapping.create({
      connectorId: orgA.connector.id,
      controlId: orgA.control.id,
      evidenceType: "aws_iam_mfa_enforced",
    });

    const callerB = createCaller(orgB.org.id, orgB.user.id, Role.ADMIN);
    await expect(callerB.evidenceMapping.update({ id: mapping.id, schedule: "0 4 * * *" })).rejects.toThrow(
      TRPCError,
    );
    await expect(callerB.evidenceMapping.delete({ id: mapping.id })).rejects.toThrow(TRPCError);
    await expect(callerB.evidenceMapping.triggerNow({ id: mapping.id })).rejects.toThrow(TRPCError);

    await expect(callerB.evidenceMapping.listByConnector({ connectorId: orgA.connector.id })).rejects.toThrow(
      TRPCError,
    );
    await expect(callerB.evidenceMapping.listByControl({ controlId: orgA.control.id })).rejects.toThrow(
      TRPCError,
    );
  });

  it("delete removes the DB row and removes the repeatable job (no orphaned schedule leak)", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const mapping = await caller.evidenceMapping.create({
      connectorId: orgA.connector.id,
      controlId: orgA.control.id,
      evidenceType: "aws_cloudtrail_enabled",
    });

    await caller.evidenceMapping.delete({ id: mapping.id });

    expect(removeRepeatableJob).toHaveBeenCalledWith(mapping.id);
    const found = await prisma.evidenceMapping.findUnique({ where: { id: mapping.id } });
    expect(found).toBeNull();
  });

  it("triggerNow enqueues a one-off job independent of the schedule", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const mapping = await caller.evidenceMapping.create({
      connectorId: orgA.connector.id,
      controlId: orgA.control.id,
      evidenceType: "aws_cloudtrail_enabled",
    });

    const result = await caller.evidenceMapping.triggerNow({ id: mapping.id });

    expect(result.jobId).toBe("job-123");
    expect(enqueueImmediateCollection).toHaveBeenCalledWith(mapping.id);
  });

  it("update reschedules the repeatable job", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const mapping = await caller.evidenceMapping.create({
      connectorId: orgA.connector.id,
      controlId: orgA.control.id,
      evidenceType: "aws_cloudtrail_enabled",
    });

    const updated = await caller.evidenceMapping.update({ id: mapping.id, schedule: "0 */6 * * *" });

    expect(updated.schedule).toBe("0 */6 * * *");
    expect(addOrUpdateRepeatableJob).toHaveBeenLastCalledWith(mapping.id, "0 */6 * * *");
  });
});
