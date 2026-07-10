process.env.WEBHOOK_ENCRYPTION_KEY =
  process.env.WEBHOOK_ENCRYPTION_KEY ??
  "db4b123385e764d3ba36c585a895c339884dc4be8dd081e8fe9415c0d13ce89";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { TRPCError } from "@trpc/server";

// Router-logic + real-DB integration tests — the actual HTTP delivery is
// covered separately by webhookWorker.test.ts. Mocking the queue keeps this
// suite fast and infra-independent, and (per evidenceMapping.router.test.ts's
// hard-won lesson) we deliberately import only the router under test rather
// than the full appRouter, whose import graph pulls in half a dozen other
// BullMQ queues that open real Redis connections at module-load time.
const enqueueWebhookDelivery = jest.fn().mockResolvedValue("job-123");

jest.mock("@/server/queue/webhookQueue", () => ({
  enqueueWebhookDelivery: (...args: any[]) => enqueueWebhookDelivery(...args),
}));

// eslint-disable-next-line import/first
import { webhookRouter } from "@/server/routers/webhook";

const testRouter = createTRPCRouter({ webhook: webhookRouter });

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
  return { org, user };
}

describe("webhook router", () => {
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

  it("rejects a non-HTTPS URL", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    await expect(
      caller.webhook.create({ url: "http://example.com/hook", events: ["evidence.updated"] }),
    ).rejects.toThrow();
  });

  it("rejects an empty events list", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    await expect(
      caller.webhook.create({ url: "https://example.com/hook", events: [] }),
    ).rejects.toThrow();
  });

  it("rejects an event not in the allowed set", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    await expect(
      caller.webhook.create({ url: "https://example.com/hook", events: ["not.a.real.event" as any] }),
    ).rejects.toThrow();
  });

  it("creates a webhook and returns the full secret exactly once", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const created = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated", "control.failed"],
    });

    expect(created.secret).toBeDefined();
    expect(typeof created.secret).toBe("string");
    expect(created.secret.length).toBeGreaterThan(20);

    const list = await caller.webhook.list();
    const listed = list.find((w: { id: string }) => w.id === created.id)!;
    expect((listed as any).secret).toBeUndefined();
    expect(listed.secretPreview).toMatch(/^••••/);
    expect(listed.secretPreview).not.toContain(created.secret);
  });

  it("enforces RBAC — a VIEWER cannot create a webhook", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.VIEWER);
    await expect(
      caller.webhook.create({ url: "https://example.com/hook", events: ["evidence.updated"] }),
    ).rejects.toThrow();
  });

  it("enforces tenant isolation — org B cannot read, update, delete, or test-deliver org A's webhook", async () => {
    const callerA = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const webhook = await callerA.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    const callerB = createCaller(orgB.org.id, orgB.user.id, Role.ADMIN);
    await expect(callerB.webhook.update({ id: webhook.id, isActive: false })).rejects.toThrow(TRPCError);
    await expect(callerB.webhook.delete({ id: webhook.id })).rejects.toThrow(TRPCError);
    await expect(callerB.webhook.testDeliver({ id: webhook.id })).rejects.toThrow(TRPCError);
    await expect(callerB.webhook.listDeliveries({ webhookId: webhook.id })).rejects.toThrow(TRPCError);

    const listB = await callerB.webhook.list();
    expect(listB.find((w: { id: string }) => w.id === webhook.id)).toBeUndefined();
  });

  it("update changes url/events/isActive", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const webhook = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    const updated = await caller.webhook.update({
      id: webhook.id,
      isActive: false,
      events: ["control.failed"],
    });

    expect(updated.isActive).toBe(false);
    expect(updated.events).toEqual(["control.failed"]);
  });

  it("delete removes the webhook row", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const webhook = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    await caller.webhook.delete({ id: webhook.id });

    const found = await prisma.webhook.findUnique({ where: { id: webhook.id } });
    expect(found).toBeNull();
  });

  it("testDeliver enqueues a webhook.test event", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const webhook = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    const result = await caller.webhook.testDeliver({ id: webhook.id });

    expect(result.jobId).toBe("job-123");
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ webhookId: webhook.id, event: "webhook.test" }),
    );
  });

  it("testDeliver is rate-limited beyond the per-minute cap", async () => {
    // Uses a dedicated org so this test's rate-limit bucket (keyed by
    // organizationId) starts fresh, unaffected by testDeliver calls made
    // against orgA in earlier tests in this file.
    const orgC = await seedOrg("OrgC-RateLimit");
    const caller = createCaller(orgC.org.id, orgC.user.id, Role.ADMIN);
    const webhook = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    for (let i = 0; i < 10; i++) {
      await caller.webhook.testDeliver({ id: webhook.id });
    }

    await expect(caller.webhook.testDeliver({ id: webhook.id })).rejects.toThrow(TRPCError);

    await prisma.organization.delete({ where: { id: orgC.org.id } }).catch(() => undefined);
  });

  it("listDeliveries returns delivery history ordered by most recent", async () => {
    const caller = createCaller(orgA.org.id, orgA.user.id, Role.ADMIN);
    const webhook = await caller.webhook.create({
      url: "https://example.com/hook",
      events: ["evidence.updated"],
    });

    await prisma.webhookDelivery.create({
      data: { webhookId: webhook.id, event: "evidence.updated", payload: {}, responseCode: 200, success: true },
    });
    await prisma.webhookDelivery.create({
      data: { webhookId: webhook.id, event: "control.failed", payload: {}, responseCode: 500, success: false },
    });

    const deliveries = await caller.webhook.listDeliveries({ webhookId: webhook.id });
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].event).toBe("control.failed");
  });
});
