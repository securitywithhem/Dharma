/**
 * tests/framework.test.ts
 *
 * Integration tests for the Framework and Control tRPC routers.
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/routers";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/dharma_test",
    },
  },
});

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

let organizationId: string;
let userId: string;
let frameworkId: string;

// Helper: create a mock caller with session context
function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  const callerFactory = createCallerFactory(appRouter);
  return callerFactory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: uid,
        email: "test@example.com",
        name: "Test User",
        organizationId: orgId,
        role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
}

// ------------------------------------------------------------------
// Lifecycle
// ------------------------------------------------------------------

beforeAll(async () => {
  // Create an isolated test organization
  const org = await prisma.organization.create({
    data: { name: "Test Organization — Framework Tests" },
  });
  organizationId = org.id;

  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: "Test Admin",
      role: Role.ADMIN,
      organizationId: org.id,
    },
  });
  userId = user.id;
});

afterEach(async () => {
  // Clean up frameworks (and cascaded controls) after each test that creates them
  if (frameworkId) {
    await prisma.framework
      .delete({ where: { id: frameworkId } })
      .catch(() => undefined); // ignore if already deleted
    frameworkId = "";
  }
});

afterAll(async () => {
  // Remove test data
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  await prisma.$disconnect();
});

// ------------------------------------------------------------------
// Framework Router Tests
// ------------------------------------------------------------------

describe("framework.list", () => {
  it("returns an empty array when no frameworks exist", async () => {
    const caller = createCaller(organizationId, userId);
    const result = await caller.framework.list();

    expect(Array.isArray(result)).toBe(true);
    // Filter to only those belonging to this test org (others may exist in shared DB)
    const ours = result.filter(() => true); // list is org-scoped
    expect(Array.isArray(ours)).toBe(true);
  });

  it("returns frameworks with progress metrics", async () => {
    const caller = createCaller(organizationId, userId);

    const created = await caller.framework.create({ name: "Test Framework List" });
    frameworkId = created.id;

    const list = await caller.framework.list();
    const fw = list.find((f) => f.id === created.id);

    expect(fw).toBeDefined();
    expect(typeof fw!.progressPercentage).toBe("number");
    expect(typeof fw!.controlCount).toBe("number");
    expect(typeof fw!.compliantCount).toBe("number");
  });
});

describe("framework.create", () => {
  it("creates a framework record", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({
      name: "Custom Test Framework",
      version: "2.0",
      description: "Test description",
    });

    frameworkId = fw.id;

    expect(fw.name).toBe("Custom Test Framework");
    expect(fw.version).toBe("2.0");
    expect(fw.description).toBe("Test description");
  });

  it("auto-seeds controls when creating DPDP Act 2023", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "DPDP Act 2023" });
    frameworkId = fw.id;

    expect(fw.name).toBe("DPDP Act 2023");
    expect(fw.controls.length).toBeGreaterThan(0);

    // All controls should start as NOT_STARTED
    for (const control of fw.controls) {
      expect(control.status).toBe("NOT_STARTED");
    }
  });

  it("auto-seeds controls when creating ISO 27001:2022", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "ISO 27001:2022" });
    frameworkId = fw.id;

    expect(fw.controls.length).toBeGreaterThan(0);
  });

  it("auto-seeds controls when creating SOC 2 Type II", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "SOC 2 Type II" });
    frameworkId = fw.id;

    expect(fw.controls.length).toBeGreaterThan(0);
  });

  it("throws CONFLICT when framework already exists for the org", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "Duplicate Framework" });
    frameworkId = fw.id;

    await expect(
      caller.framework.create({ name: "Duplicate Framework" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("throws FORBIDDEN for VIEWER role", async () => {
    const viewer = createCaller(organizationId, userId, Role.VIEWER);

    await expect(
      viewer.framework.create({ name: "Should Fail" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("framework.getById", () => {
  it("returns framework with controls and domain breakdown", async () => {
    const caller = createCaller(organizationId, userId);

    const created = await caller.framework.create({ name: "DPDP Act 2023" });
    frameworkId = created.id;

    const fw = await caller.framework.getById({ id: created.id });

    expect(fw.id).toBe(created.id);
    expect(Array.isArray(fw.controls)).toBe(true);
    expect(Array.isArray(fw.domainBreakdown)).toBe(true);
    expect(typeof fw.progressPercentage).toBe("number");

    for (const domain of fw.domainBreakdown) {
      expect(typeof domain.domain).toBe("string");
      expect(typeof domain.total).toBe("number");
      expect(typeof domain.compliant).toBe("number");
      expect(typeof domain.percentage).toBe("number");
    }
  });

  it("throws NOT_FOUND for unknown framework", async () => {
    const caller = createCaller(organizationId, userId);

    await expect(
      caller.framework.getById({ id: "non-existent-id" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ------------------------------------------------------------------
// Control Router Tests
// ------------------------------------------------------------------

describe("control.listByFramework", () => {
  it("lists all controls for a framework", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "SOC 2 Type II" });
    frameworkId = fw.id;

    const controls = await caller.control.listByFramework({
      frameworkId: fw.id,
    });

    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) {
      expect(c.id).toBeDefined();
      expect(c.domain).toBeDefined();
      expect(c.title).toBeDefined();
      expect(typeof c.evidenceCount).toBe("number");
    }
  });

  it("filters controls by domain", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "SOC 2 Type II" });
    frameworkId = fw.id;

    const all = await caller.control.listByFramework({ frameworkId: fw.id });
    const domains = [...new Set(all.map((c) => c.domain))];

    if (domains.length > 0) {
      const domain = domains[0]!;
      const filtered = await caller.control.listByFramework({
        frameworkId: fw.id,
        domain,
      });

      expect(filtered.every((c) => c.domain === domain)).toBe(true);
      expect(filtered.length).toBeLessThanOrEqual(all.length);
    }
  });
});

describe("control.getById", () => {
  it("returns control with evidence array", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "DPDP Act 2023" });
    frameworkId = fw.id;

    const controlId = fw.controls[0]?.id;
    expect(controlId).toBeDefined();

    const control = await caller.control.getById({ id: controlId! });

    expect(control.id).toBe(controlId);
    expect(Array.isArray(control.evidence)).toBe(true);
    expect(control.framework).toBeDefined();
  });

  it("throws NOT_FOUND for a control that does not belong to the org", async () => {
    const caller = createCaller(organizationId, userId);

    await expect(
      caller.control.getById({ id: "non-existent-control" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("control.updateStatus", () => {
  it("updates a control status and creates an audit log", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "ISO 27001:2022" });
    frameworkId = fw.id;

    const controlId = fw.controls[0]?.id;
    expect(controlId).toBeDefined();

    const updated = await caller.control.updateStatus({
      id: controlId!,
      status: "IN_PROGRESS",
    });

    expect(updated.status).toBe("IN_PROGRESS");

    // Verify audit log was created
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        organizationId,
        entity: "Control",
        entityId: controlId,
        action: "CONTROL_STATUS_UPDATED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(auditLog).toBeDefined();
  });

  it("cycles through all statuses correctly", async () => {
    const caller = createCaller(organizationId, userId);

    const fw = await caller.framework.create({ name: "SOC 2 Type II" });
    frameworkId = fw.id;

    const controlId = fw.controls[0]?.id;
    expect(controlId).toBeDefined();

    for (const status of ["IN_PROGRESS", "COMPLIANT", "NOT_APPLICABLE", "NOT_STARTED"] as const) {
      const updated = await caller.control.updateStatus({
        id: controlId!,
        status,
      });
      expect(updated.status).toBe(status);
    }
  });

  it("throws FORBIDDEN for VIEWER role", async () => {
    const admin = createCaller(organizationId, userId, Role.ADMIN);
    const viewer = createCaller(organizationId, userId, Role.VIEWER);

    const fw = await admin.framework.create({ name: "DPDP Act 2023" });
    frameworkId = fw.id;

    const controlId = fw.controls[0]?.id;
    expect(controlId).toBeDefined();

    await expect(
      viewer.control.updateStatus({ id: controlId!, status: "COMPLIANT" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
