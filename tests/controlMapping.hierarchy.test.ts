import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// Import only the routers under test — importing the full appRouter would pull
// in unrelated BullMQ queues that open real Redis connections at module load
// (same rationale as tests/control.hierarchy.test.ts and
// tests/evidenceMapping.router.test.ts).
// eslint-disable-next-line import/first
import { controlRouter } from "@/server/routers/control";
// eslint-disable-next-line import/first
import { controlMappingRouter } from "@/server/routers/controlMapping";
// eslint-disable-next-line import/first
import { embedControl } from "@/server/services/controlEmbeddings";

const testRouter = createTRPCRouter({ control: controlRouter, controlMapping: controlMappingRouter });
const prisma = new PrismaClient();

function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: uid, email: "t@example.com", name: "T", organizationId: orgId, role },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

async function seedOrgWithTwoFrameworks(label: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  const frameworkA = await prisma.framework.create({ data: { name: `${label} FW-A ${stamp}`, organizationId: org.id } });
  const frameworkB = await prisma.framework.create({ data: { name: `${label} FW-B ${stamp}`, organizationId: org.id } });
  return { org, user, frameworkA, frameworkB };
}

/** Creates a root control with a materialized path, the way Part 1's createChild does. */
async function makeControl(frameworkId: string, domain: string, title: string, description: string) {
  const c = await prisma.control.create({ data: { frameworkId, domain, title, description } });
  await prisma.control.update({ where: { id: c.id }, data: { path: [c.id] } });
  return c;
}

describe("controlMapping router", () => {
  let orgA: Awaited<ReturnType<typeof seedOrgWithTwoFrameworks>>;
  let orgB: Awaited<ReturnType<typeof seedOrgWithTwoFrameworks>>;

  beforeAll(async () => {
    orgA = await seedOrgWithTwoFrameworks("MapOrgA");
    orgB = await seedOrgWithTwoFrameworks("MapOrgB");
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgA.org.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: orgB.org.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  describe("create validation", () => {
    it("rejects self-mapping", async () => {
      const caller = createCaller(orgA.org.id, orgA.user.id);
      const c = await makeControl(orgA.frameworkA.id, "Access Control", "AC-1", "desc");
      await expect(
        caller.controlMapping.create({ sourceControlId: c.id, targetControlId: c.id, mappingStrength: "EQUIVALENT" }),
      ).rejects.toThrow(/cannot be mapped to itself/i);
    });

    it("rejects mapping a control from another org", async () => {
      const callerA = createCaller(orgA.org.id, orgA.user.id);
      const source = await makeControl(orgA.frameworkA.id, "Access Control", "AC-2", "desc");
      const foreignTarget = await makeControl(orgB.frameworkA.id, "Access Control", "AC-2", "desc");
      await expect(
        callerA.controlMapping.create({
          sourceControlId: source.id,
          targetControlId: foreignTarget.id,
          mappingStrength: "EQUIVALENT",
        }),
      ).rejects.toThrow(/not found/i);
    });

    it("rejects a duplicate mapping in either direction", async () => {
      const caller = createCaller(orgA.org.id, orgA.user.id);
      const source = await makeControl(orgA.frameworkA.id, "Access Control", "AC-3", "desc");
      const target = await makeControl(orgA.frameworkB.id, "Access Control", "A.9.2.1", "desc");

      await caller.controlMapping.create({ sourceControlId: source.id, targetControlId: target.id, mappingStrength: "PARTIAL" });

      await expect(
        caller.controlMapping.create({ sourceControlId: source.id, targetControlId: target.id, mappingStrength: "RELATED" }),
      ).rejects.toThrow(/already exists/i);

      // Reverse direction is the same logical mapping — also rejected.
      await expect(
        caller.controlMapping.create({ sourceControlId: target.id, targetControlId: source.id, mappingStrength: "RELATED" }),
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe("update / delete", () => {
    it("updates strength and deletes a mapping, both audited", async () => {
      const caller = createCaller(orgA.org.id, orgA.user.id);
      const source = await makeControl(orgA.frameworkA.id, "Access Control", "AC-4", "desc");
      const target = await makeControl(orgA.frameworkB.id, "Access Control", "A.9.2.4", "desc");
      const mapping = await caller.controlMapping.create({
        sourceControlId: source.id,
        targetControlId: target.id,
        mappingStrength: "PARTIAL",
      });

      const updated = await caller.controlMapping.update({ id: mapping.id, mappingStrength: "EQUIVALENT" });
      expect(updated.mappingStrength).toBe("EQUIVALENT");

      await caller.controlMapping.delete({ id: mapping.id });
      expect(await prisma.controlMapping.findUnique({ where: { id: mapping.id } })).toBeNull();

      const auditActions = await prisma.auditLog.findMany({
        where: { organizationId: orgA.org.id, entityId: mapping.id },
        select: { action: true },
      });
      expect(auditActions.map((a) => a.action).sort()).toEqual(
        ["CONTROL_MAPPING_CREATED", "CONTROL_MAPPING_DELETED", "CONTROL_MAPPING_UPDATED"].sort(),
      );
    });
  });

  describe("listForFrameworkPair", () => {
    it("returns mappings plus each side's unmapped controls", async () => {
      const local = await seedOrgWithTwoFrameworks("ListPair");
      const caller = createCaller(local.org.id, local.user.id);
      const a1 = await makeControl(local.frameworkA.id, "D1", "A1", "desc");
      const a2 = await makeControl(local.frameworkA.id, "D1", "A2", "desc");
      const b1 = await makeControl(local.frameworkB.id, "D1", "B1", "desc");
      await makeControl(local.frameworkB.id, "D1", "B2", "desc");

      await caller.controlMapping.create({ sourceControlId: a1.id, targetControlId: b1.id, mappingStrength: "EQUIVALENT" });

      const result = await caller.controlMapping.listForFrameworkPair({
        frameworkAId: local.frameworkA.id,
        frameworkBId: local.frameworkB.id,
      });

      expect(result.mappings).toHaveLength(1);
      expect(result.unmappedA.map((c) => c.id)).toEqual([a2.id]);
      expect(result.unmappedB.map((c) => c.title)).toEqual(["B2"]);

      await prisma.organization.delete({ where: { id: local.org.id } }).catch(() => undefined);
    });
  });

  describe("getOverlapMatrix", () => {
    it("computes correct per-family totals, mapped counts, and coverage percentages", async () => {
      const local = await seedOrgWithTwoFrameworks("Overlap");
      const caller = createCaller(local.org.id, local.user.id);

      // Framework A: one family "Access Control" with 2 children (depth 1).
      const famA = await makeControl(local.frameworkA.id, "Access Control", "Access Control Family", "desc");
      const childA1 = await prisma.control.create({
        data: { frameworkId: local.frameworkA.id, domain: "Access Control", title: "AC-2", description: "d", parentId: famA.id, depth: 1 },
      });
      await prisma.control.update({ where: { id: childA1.id }, data: { path: [famA.id, childA1.id] } });
      const childA2 = await prisma.control.create({
        data: { frameworkId: local.frameworkA.id, domain: "Access Control", title: "AC-3", description: "d", parentId: famA.id, depth: 1 },
      });
      await prisma.control.update({ where: { id: childA2.id }, data: { path: [famA.id, childA2.id] } });

      // Framework B: one family with 2 children.
      const famB = await makeControl(local.frameworkB.id, "Access Control", "A.9 Family", "desc");
      const childB1 = await prisma.control.create({
        data: { frameworkId: local.frameworkB.id, domain: "Access Control", title: "A.9.2.1", description: "d", parentId: famB.id, depth: 1 },
      });
      await prisma.control.update({ where: { id: childB1.id }, data: { path: [famB.id, childB1.id] } });

      // Map 1 of 2 childA controls to 1 childB control (fixture: 50% coverage on A's side).
      await caller.controlMapping.create({
        sourceControlId: childA1.id,
        targetControlId: childB1.id,
        mappingStrength: "EQUIVALENT",
      });

      const matrix = await caller.controlMapping.getOverlapMatrix({
        frameworkAId: local.frameworkA.id,
        frameworkBId: local.frameworkB.id,
      });

      const familyA = matrix.familiesA.find((f) => f.familyId === famA.id)!;
      // Family A has 3 controls total (itself + 2 children), 1 mapped.
      expect(familyA.totalControls).toBe(3);
      expect(familyA.mappedControls).toBe(1);
      expect(familyA.coveragePct).toBeCloseTo((1 / 3) * 100, 1);

      const familyB = matrix.familiesB.find((f) => f.familyId === famB.id)!;
      expect(familyB.totalControls).toBe(2);
      expect(familyB.mappedControls).toBe(1);
      expect(familyB.coveragePct).toBe(50);

      const cell = matrix.cells.find((c) => c.familyAId === famA.id && c.familyBId === famB.id)!;
      expect(cell.mappingCount).toBe(1);

      await prisma.organization.delete({ where: { id: local.org.id } }).catch(() => undefined);
    });
  });

  describe("tenant isolation", () => {
    it("org B's getOverlapMatrix never returns org A's frameworks/data", async () => {
      const callerB = createCaller(orgB.org.id, orgB.user.id);
      await expect(
        callerB.controlMapping.getOverlapMatrix({ frameworkAId: orgA.frameworkA.id, frameworkBId: orgA.frameworkB.id }),
      ).rejects.toThrow(/not found/i);
      await expect(
        callerB.controlMapping.listForFrameworkPair({ frameworkAId: orgA.frameworkA.id, frameworkBId: orgA.frameworkB.id }),
      ).rejects.toThrow(/not found/i);
      await expect(
        callerB.controlMapping.getSuggestions({ controlId: "nonexistent-or-orgA-control", targetFrameworkId: orgA.frameworkB.id }),
      ).resolves.toEqual([]);
    });
  });

  describe("AI-suggested mappings", () => {
    // Requires a reachable Ollama instance with nomic-embed-text pulled — this
    // repo's docker-compose `ollama` service. Skipped automatically if
    // unreachable so the suite doesn't fail in environments without it.
    let ollamaAvailable = false;

    beforeAll(async () => {
      try {
        const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
        ollamaAvailable = res.ok;
      } catch {
        ollamaAvailable = false;
      }
    });

    it("suggests a near-identical control in the top-3 with confidence > 0.8", async () => {
      if (!ollamaAvailable) {
        console.warn("[test] Ollama unreachable at localhost:11434 — skipping AI suggestion test.");
        return;
      }

      const local = await seedOrgWithTwoFrameworks("AISuggest");
      const caller = createCaller(local.org.id, local.user.id);

      const source = await makeControl(
        local.frameworkA.id,
        "Access Control",
        "Multi-Factor Authentication",
        "The organization requires multi-factor authentication for all access to production systems handling sensitive customer data.",
      );
      const nearIdentical = await makeControl(
        local.frameworkB.id,
        "Access Control",
        "Multi-Factor Authentication Requirement",
        "The organization shall require multi-factor authentication for all access to production systems that handle sensitive customer data.",
      );
      // Two unrelated distractors in the target framework.
      await makeControl(local.frameworkB.id, "Physical Security", "Badge Access", "Physical badge readers control entry to office premises.");
      await makeControl(local.frameworkB.id, "HR", "Background Checks", "Employees undergo background checks prior to hiring.");

      await embedControl(prisma, source.id);
      await embedControl(prisma, nearIdentical.id);

      const refreshedSource = await prisma.control.findUniqueOrThrow({ where: { id: source.id }, select: { embeddingStatus: true } });
      expect(refreshedSource.embeddingStatus).toBe("SUCCESS");

      const suggestions = await caller.controlMapping.getSuggestions({
        controlId: source.id,
        targetFrameworkId: local.frameworkB.id,
        topK: 3,
      });

      expect(suggestions.length).toBeGreaterThan(0);
      const top = suggestions.find((s) => s.controlId === nearIdentical.id);
      expect(top).toBeDefined();
      expect(top!.confidenceScore).toBeGreaterThan(0.8);

      await prisma.organization.delete({ where: { id: local.org.id } }).catch(() => undefined);
    }, 30_000);
  });
});
