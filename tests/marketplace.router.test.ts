/**
 * WAVE 5.2 — marketplace authorization, moderation and audit coverage.
 *
 * Closes fullstack-audit-2026-08-06 BE-2, BE-5, BE-6, BE-7 (and BE-8 in
 * tests/marketplace.service.test.ts).
 *
 * This replaces a mock-only suite that asserted "publishItem calls service
 * with auth ctx" while the router had no authorization check at all — it
 * passed throughout the entire window the vulnerability was open, which is
 * why this version talks to the real database and asserts refusals.
 *
 * Every `rejects` case below succeeds on the pre-fix router.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role, ItemType } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { marketplaceRouter } from "@/server/routers/marketplace";
import { closeSessionIdentityRedis } from "@/server/lib/sessionIdentity";
import { seedRoleUser } from "./fixtures/seedRoleUser";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ marketplace: marketplaceRouter });

function callerFor(user: { id: string; organizationId: string; role: Role }) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: user.id,
        email: "marketplace@test.dharma",
        name: "Marketplace Test",
        organizationId: user.organizationId,
        role: user.role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

const validFrameworkMetadata = {
  frameworkName: "Test Framework",
  controls: [{ identifier: "A.1", title: "A control", domain: "Security" }],
};

function publishInput(slug: string) {
  return {
    type: ItemType.FRAMEWORK,
    name: "Test Framework",
    slug,
    description: "A framework published by the test suite.",
    category: "compliance",
    tags: ["test"],
    metadata: validFrameworkMetadata,
  };
}

let orgA: string;
let orgB: string;
let publisher: { id: string; organizationId: string; role: Role };
let viewer: { id: string; organizationId: string; role: Role };
let tenantAdminA: { id: string; organizationId: string; role: Role };
let tenantAdminB: { id: string; organizationId: string; role: Role };
let platformAdmin: { id: string; organizationId: string; role: Role };

let seq = 0;
const uniqueSlug = (p: string) => `${p}-${Date.now()}-${(seq += 1)}`;

beforeAll(async () => {
  orgA = (await prisma.organization.create({ data: { name: `mkt-a-${Date.now()}` } })).id;
  orgB = (await prisma.organization.create({ data: { name: `mkt-b-${Date.now()}` } })).id;

  publisher = await seedRoleUser(prisma, orgA, Role.PUBLISHER, "mkt");
  viewer = await seedRoleUser(prisma, orgA, Role.VIEWER, "mkt");
  tenantAdminA = await seedRoleUser(prisma, orgA, Role.ADMIN, "mkt");
  tenantAdminB = await seedRoleUser(prisma, orgB, Role.ADMIN, "mkt");

  // A platform admin is designated out of band — there is deliberately no API
  // that grants isPlatformAdmin, so the test writes it directly, exactly as an
  // operator would.
  const pa = await seedRoleUser(prisma, orgA, Role.ADMIN, "mkt");
  await prisma.user.update({ where: { id: pa.id }, data: { isPlatformAdmin: true } });
  platformAdmin = pa;
});

afterAll(async () => {
  await prisma.marketplaceItem.deleteMany({
    where: { authorId: { in: [publisher.id, tenantAdminA.id, platformAdmin.id] } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("publishItem authorization (BE-2)", () => {
  it("refuses a signed-in user who is not a publisher or admin", async () => {
    // The headline finding: `// Basic check, in reality verify role is
    // PUBLISHER or ADMIN` sat above a mutation with no check, so any
    // signed-in user could publish content every other tenant imports.
    await expect(
      callerFor(viewer).marketplace.publishItem(publishInput(uniqueSlug("viewer-attempt"))),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const leaked = await prisma.marketplaceItem.findFirst({
      where: { authorId: viewer.id },
    });
    expect(leaked).toBeNull();
  });

  it("allows a PUBLISHER", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("publisher-ok")),
    );
    expect(item.authorId).toBe(publisher.id);
  });

  it("allows an org ADMIN", async () => {
    const item = await callerFor(tenantAdminA).marketplace.publishItem(
      publishInput(uniqueSlug("admin-ok")),
    );
    expect(item.authorId).toBe(tenantAdminA.id);
  });
});

describe("moderation cannot be bypassed (BE-2)", () => {
  it("ignores a client-supplied isPublic — a new item is never live on create", async () => {
    // `isPublic` used to be in the input schema and passed straight into
    // marketplaceItem.create, so setting one boolean skipped approval
    // entirely. It is no longer accepted; Zod strips the unknown key.
    const item = await callerFor(publisher).marketplace.publishItem({
      ...publishInput(uniqueSlug("sneaky")),
      isPublic: true,
    } as never);

    expect(item.isPublic).toBe(false);
    expect(item.publishedAt).toBeNull();

    const stored = await prisma.marketplaceItem.findUnique({ where: { id: item.id } });
    expect(stored?.isPublic).toBe(false);
  });

  it("keeps an unapproved item out of the public listing", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("unlisted")),
    );
    const listed = await prisma.marketplaceItem.findMany({
      where: { isPublic: true, id: item.id },
    });
    expect(listed).toHaveLength(0);
  });

  it("refuses to import an item that was never approved", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("unapproved-import")),
    );

    await expect(
      callerFor(tenantAdminB).marketplace.importItem({ marketplaceItemId: item.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("platform admin vs tenant admin (BE-2)", () => {
  it("refuses a tenant ADMIN approving another tenant's submission", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("cross-tenant-approve")),
    );

    // orgB's admin is a full ADMIN — of orgB. The old check was
    // `role !== "ADMIN"`, so this succeeded and pushed another tenant's item
    // into the shared catalogue.
    await expect(
      callerFor(tenantAdminB).marketplace.approveItem({ id: item.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stored = await prisma.marketplaceItem.findUnique({ where: { id: item.id } });
    expect(stored?.isPublic).toBe(false);
  });

  it("refuses a tenant ADMIN listing the moderation queue", async () => {
    await expect(
      callerFor(tenantAdminA).marketplace.getPendingItems(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows a platform admin to approve, and only then is the item importable", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("approve-flow")),
    );

    const approved = await callerFor(platformAdmin).marketplace.approveItem({ id: item.id });
    expect(approved.isPublic).toBe(true);
    expect(approved.publishedAt).not.toBeNull();

    const imported = await callerFor(tenantAdminB).marketplace.importItem({
      marketplaceItemId: item.id,
    });
    expect(imported.organizationId).toBe(orgB);
  });

  it("rejectItem withdraws an item without deleting importers' provenance", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("reject-flow")),
    );
    await callerFor(platformAdmin).marketplace.approveItem({ id: item.id });

    const rejected = await callerFor(platformAdmin).marketplace.rejectItem({
      id: item.id,
      reason: "Does not meet catalogue standards.",
    });

    expect(rejected.isPublic).toBe(false);
    // The row survives, so ImportedItem.sourceItem references stay intact.
    expect(await prisma.marketplaceItem.findUnique({ where: { id: item.id } })).not.toBeNull();
  });
});

describe("metadata is validated, not free JSON (BE-2)", () => {
  it("rejects a FRAMEWORK item whose metadata has no controls", async () => {
    await expect(
      callerFor(publisher).marketplace.publishItem({
        ...publishInput(uniqueSlug("bad-metadata")),
        metadata: { arbitrary: "junk" },
      }),
    ).rejects.toThrow();
  });

  it("rejects metadata that does not match the declared item type", async () => {
    // Declares CONNECTOR but ships a FRAMEWORK's control tree. `kind` is
    // injected from `type` server-side, so this cannot slip past.
    await expect(
      callerFor(publisher).marketplace.publishItem({
        ...publishInput(uniqueSlug("type-mismatch")),
        type: ItemType.CONNECTOR,
        metadata: validFrameworkMetadata,
      }),
    ).rejects.toThrow();
  });

  it("rejects a malformed slug", async () => {
    await expect(
      callerFor(publisher).marketplace.publishItem({
        ...publishInput("Not A Valid Slug!"),
      }),
    ).rejects.toThrow();
  });
});

describe("errors carry actionable codes, not INTERNAL_SERVER_ERROR (BE-7)", () => {
  it("returns NOT_FOUND for an unknown item", async () => {
    await expect(
      callerFor(publisher).marketplace.getItem({ identifier: "does-not-exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns FORBIDDEN when updating an item authored by someone else", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("not-yours")),
    );

    await expect(
      callerFor(tenantAdminA).marketplace.publishItem({
        ...publishInput(uniqueSlug("not-yours-update")),
        id: item.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("audit coverage (BE-5)", () => {
  it("writes an audit entry for publish, approve and import", async () => {
    const item = await callerFor(publisher).marketplace.publishItem(
      publishInput(uniqueSlug("audited")),
    );
    await callerFor(platformAdmin).marketplace.approveItem({ id: item.id });
    await callerFor(tenantAdminB).marketplace.importItem({ marketplaceItemId: item.id });

    const actions = await prisma.auditLog.findMany({
      where: { entityId: item.id },
      select: { action: true },
    });
    const names = actions.map((a) => a.action);

    expect(names).toContain("MARKETPLACE_ITEM_PUBLISHED");
    expect(names).toContain("MARKETPLACE_ITEM_APPROVED");

    const importEntry = await prisma.auditLog.findFirst({
      where: { organizationId: orgB, action: "MARKETPLACE_ITEM_IMPORTED" },
    });
    expect(importEntry).not.toBeNull();
  });
});
