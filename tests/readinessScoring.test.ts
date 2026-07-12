import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role, RecommendationStatus, RecommendationType } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// Import only the routers under test — importing the full appRouter would pull
// in unrelated BullMQ queues / Stripe construction at module load (same
// rationale as tests/control.hierarchy.test.ts and
// tests/controlMapping.hierarchy.test.ts).
// eslint-disable-next-line import/first
import { readinessRouter } from "@/server/routers/readiness";
// eslint-disable-next-line import/first
import { computeReadinessScore, generateRecommendations } from "@/server/services/readinessScoring";

const testRouter = createTRPCRouter({ readiness: readinessRouter });
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

async function seedOrg(label: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  return { org, user };
}

async function makeRootControl(frameworkId: string, title: string) {
  const c = await prisma.control.create({ data: { frameworkId, domain: "D", title, description: "d" } });
  await prisma.control.update({ where: { id: c.id }, data: { path: [c.id] } });
  return c;
}

async function addEvidence(controlId: string, organizationId: string, opts?: { collectedAt?: Date; expiresAt?: Date | null }) {
  return prisma.evidence.create({
    data: {
      controlId,
      organizationId,
      fileName: "f.pdf",
      filePath: "x",
      type: "POLICY_DOC",
      collectedAt: opts?.collectedAt ?? new Date(),
      expiresAt: opts?.expiresAt,
    },
  });
}

describe("readiness scoring", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("computeReadinessScore", () => {
    it("matches the deterministic fixture: 5 evidenced, 2 EQUIVALENT-mapped, 3 nothing", async () => {
      const { org, } = await seedOrg("ScoreFixture");
      const fwA = await prisma.framework.create({ data: { name: "FW-A", organizationId: org.id } });
      const fwB = await prisma.framework.create({ data: { name: "FW-B", organizationId: org.id } });

      const leavesA = [];
      for (let i = 0; i < 10; i++) leavesA.push(await makeRootControl(fwA.id, `A-${i}`));

      for (let i = 0; i < 5; i++) await addEvidence(leavesA[i].id, org.id);

      for (let i = 5; i < 7; i++) {
        const target = await makeRootControl(fwB.id, `B-${i}`);
        await addEvidence(target.id, org.id);
        await prisma.controlMapping.create({
          data: {
            organizationId: org.id,
            sourceControlId: leavesA[i].id,
            targetControlId: target.id,
            mappingStrength: "EQUIVALENT",
            createdById: "system",
          },
        });
      }
      // indices 7-9: nothing.

      const result = await computeReadinessScore(prisma, org.id, fwA.id);
      expect(result.evidenceScore).toBe(42.5);
      expect(result.mappingBonus).toBe(3);
      expect(result.overallScore).toBe(45.5);
      expect(result.breakdown.totalLeaves).toBe(10);
      expect(result.breakdown.evidencedLeaves).toBe(5);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });

    it("gives PARTIAL mappings half credit of EQUIVALENT", async () => {
      const { org } = await seedOrg("PartialCredit");
      const fwA = await prisma.framework.create({ data: { name: "FW-A", organizationId: org.id } });
      const fwB = await prisma.framework.create({ data: { name: "FW-B", organizationId: org.id } });

      const source = await makeRootControl(fwA.id, "A-0");
      const target = await makeRootControl(fwB.id, "B-0");
      await addEvidence(target.id, org.id);
      await prisma.controlMapping.create({
        data: { organizationId: org.id, sourceControlId: source.id, targetControlId: target.id, mappingStrength: "PARTIAL", createdById: "system" },
      });

      const result = await computeReadinessScore(prisma, org.id, fwA.id);
      // 1 leaf total, 0 evidenced, credit 0.5 → mappingBonus = min(15, 0.5/1*15) = 7.5
      expect(result.evidenceScore).toBe(0);
      expect(result.mappingBonus).toBe(7.5);
      expect(result.overallScore).toBe(7.5);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });

    it("ignores expired evidence (not acceptable) and RELATED mappings (no credit)", async () => {
      const { org } = await seedOrg("ExpiredRelated");
      const fwA = await prisma.framework.create({ data: { name: "FW-A", organizationId: org.id } });
      const fwB = await prisma.framework.create({ data: { name: "FW-B", organizationId: org.id } });

      const expiredLeaf = await makeRootControl(fwA.id, "A-expired");
      await addEvidence(expiredLeaf.id, org.id, { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

      const relatedLeaf = await makeRootControl(fwA.id, "A-related");
      const target = await makeRootControl(fwB.id, "B-0");
      await addEvidence(target.id, org.id);
      await prisma.controlMapping.create({
        data: { organizationId: org.id, sourceControlId: relatedLeaf.id, targetControlId: target.id, mappingStrength: "RELATED", createdById: "system" },
      });

      const result = await computeReadinessScore(prisma, org.id, fwA.id);
      expect(result.overallScore).toBe(0); // expired evidence doesn't count; RELATED earns no credit

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });
  });

  describe("generateRecommendations", () => {
    it("produces MISSING_EVIDENCE, FAMILY_LOW_COVERAGE, and STALE_EVIDENCE as expected", async () => {
      const { org } = await seedOrg("Recs");
      const fw = await prisma.framework.create({ data: { name: "FW", organizationId: org.id } });

      const stale = await makeRootControl(fw.id, "Stale Control");
      await addEvidence(stale.id, org.id, { collectedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) });

      const missing = await makeRootControl(fw.id, "Missing Control");
      void missing;

      await generateRecommendations(prisma, org.id, fw.id);

      const recs = await prisma.recommendation.findMany({ where: { organizationId: org.id, frameworkId: fw.id } });
      const types = recs.map((r) => r.type).sort();
      expect(types).toContain(RecommendationType.STALE_EVIDENCE);
      expect(types).toContain(RecommendationType.MISSING_EVIDENCE);
      expect(types).toContain(RecommendationType.FAMILY_LOW_COVERAGE);

      const staleRec = recs.find((r) => r.type === RecommendationType.STALE_EVIDENCE)!;
      expect(staleRec.potentialScoreGain).toBeNull();

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });

    it("preserves a DISMISSED recommendation unless the gap changes materially", async () => {
      const { org } = await seedOrg("DismissPreserve");
      const fw = await prisma.framework.create({ data: { name: "FW", organizationId: org.id } });
      const control = await makeRootControl(fw.id, "Never Evidenced");
      void control;

      await generateRecommendations(prisma, org.id, fw.id);
      const first = await prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.id, frameworkId: fw.id, type: RecommendationType.MISSING_EVIDENCE },
      });

      await prisma.recommendation.update({
        where: { id: first.id },
        data: { status: RecommendationStatus.DISMISSED, dismissedAt: new Date() },
      });

      // Re-run with no material change — dismissed entry should NOT be replaced by a new OPEN one.
      await generateRecommendations(prisma, org.id, fw.id);
      const afterRerun = await prisma.recommendation.findMany({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: control.id, type: RecommendationType.MISSING_EVIDENCE },
      });
      expect(afterRerun).toHaveLength(1);
      expect(afterRerun[0].status).toBe(RecommendationStatus.DISMISSED);

      // Now add a second control to the same family so totalLeaves changes materially
      // (potentialScoreGain for MISSING_EVIDENCE shifts from 85 to 42.5 — a >5pt swing).
      await makeRootControl(fw.id, "Another Root");
      await generateRecommendations(prisma, org.id, fw.id);
      const afterMaterialChange = await prisma.recommendation.findMany({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: control.id, type: RecommendationType.MISSING_EVIDENCE },
      });
      // Original DISMISSED row preserved, PLUS a fresh OPEN one re-surfaced.
      expect(afterMaterialChange.some((r) => r.status === RecommendationStatus.DISMISSED)).toBe(true);
      expect(afterMaterialChange.some((r) => r.status === RecommendationStatus.OPEN)).toBe(true);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });

    it("dismissing one family's FAMILY_LOW_COVERAGE recommendation does not affect a different family's", async () => {
      const { org } = await seedOrg("FamilyDedup");
      const fw = await prisma.framework.create({ data: { name: "FW", organizationId: org.id } });
      // Two separate root families, both empty (0% coverage, well below 50%).
      const familyX = await makeRootControl(fw.id, "Family X");
      const familyY = await makeRootControl(fw.id, "Family Y");

      await generateRecommendations(prisma, org.id, fw.id);
      const recX = await prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: familyX.id, type: RecommendationType.FAMILY_LOW_COVERAGE },
      });
      const recYBefore = await prisma.recommendation.findFirstOrThrow({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: familyY.id, type: RecommendationType.FAMILY_LOW_COVERAGE },
      });

      // Dismiss only family X's recommendation.
      await prisma.recommendation.update({ where: { id: recX.id }, data: { status: RecommendationStatus.DISMISSED, dismissedAt: new Date() } });

      // Re-run — family Y's situation is unchanged, so it must stay OPEN and
      // must not be affected by family X's dismissal (the pre-fix bug: both
      // shared a "null:FAMILY_LOW_COVERAGE" dedup key).
      await generateRecommendations(prisma, org.id, fw.id);
      const recYAfter = await prisma.recommendation.findMany({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: familyY.id, type: RecommendationType.FAMILY_LOW_COVERAGE },
      });
      // OPEN rows are fully replaced on every recompute (only DISMISSED status
      // is preserved across runs, not row identity) — so we assert content,
      // not id stability.
      expect(recYAfter).toHaveLength(1);
      expect(recYAfter[0].status).toBe(RecommendationStatus.OPEN);
      expect(recYAfter[0].title).toBe(recYBefore.title);

      // Family X's dismissal is preserved, not duplicated.
      const recXAfter = await prisma.recommendation.findMany({
        where: { organizationId: org.id, frameworkId: fw.id, controlId: familyX.id, type: RecommendationType.FAMILY_LOW_COVERAGE },
      });
      expect(recXAfter).toHaveLength(1);
      expect(recXAfter[0].status).toBe(RecommendationStatus.DISMISSED);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });
  });

  describe("integration: recompute pipeline + getScore", () => {
    it("computes score, persists it, and getScore returns the correct breakdown", async () => {
      const { org, user } = await seedOrg("Pipeline");
      const fw = await prisma.framework.create({ data: { name: "FW", organizationId: org.id } });
      const c1 = await makeRootControl(fw.id, "C1");
      await addEvidence(c1.id, org.id);
      await makeRootControl(fw.id, "C2");

      // Simulate the worker's job body directly (compute + recommendations),
      // rather than requiring a live BullMQ worker process in this test.
      await computeReadinessScore(prisma, org.id, fw.id);
      await generateRecommendations(prisma, org.id, fw.id);

      const caller = createCaller(org.id, user.id);
      const score = await caller.readiness.getScore({ frameworkId: fw.id });
      expect(score.status).toBe("ready");
      if (score.status === "ready") {
        expect(score.overallScore).toBe(42.5);
        expect(score.breakdown.totalLeaves).toBe(2);
      }

      const recs = await caller.readiness.getRecommendations({ frameworkId: fw.id, statuses: [RecommendationStatus.OPEN] });
      expect(recs.length).toBeGreaterThan(0);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    });
  });

  describe("tenant isolation", () => {
    it("org B cannot read or trigger org A's score/recommendations", async () => {
      const { org: orgA } = await seedOrg("TenantA");
      const { org: orgB, user: userB } = await seedOrg("TenantB");
      const fwA = await prisma.framework.create({ data: { name: "FW-A", organizationId: orgA.id } });
      await makeRootControl(fwA.id, "Secret Control");
      await computeReadinessScore(prisma, orgA.id, fwA.id);

      const callerB = createCaller(orgB.id, userB.id);
      await expect(callerB.readiness.getScore({ frameworkId: fwA.id })).rejects.toThrow(/not found/i);
      await expect(callerB.readiness.recompute({ frameworkId: fwA.id })).rejects.toThrow(/not found/i);
      await expect(callerB.readiness.getRecommendations({ frameworkId: fwA.id })).rejects.toThrow(/not found/i);

      await prisma.organization.delete({ where: { id: orgA.id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: orgB.id } }).catch(() => undefined);
    });
  });

  describe("performance: getScore read path", () => {
    it("meets p95 < 200ms on a ~500-control framework (compute itself is not bound by this)", async () => {
      const { org, user } = await seedOrg("Perf500");
      const fw = await prisma.framework.create({ data: { name: "FW", organizationId: org.id } });

      const controls = [];
      for (let i = 0; i < 500; i++) {
        controls.push(prisma.control.create({ data: { frameworkId: fw.id, domain: "D", title: `C-${i}`, description: "d" } }));
      }
      const created = await Promise.all(controls);
      await prisma.$transaction(created.map((c) => prisma.control.update({ where: { id: c.id }, data: { path: [c.id] } })));

      // Setup: compute once (not timed — the prompt distinguishes compute from the read path).
      await computeReadinessScore(prisma, org.id, fw.id);

      const caller = createCaller(org.id, user.id);
      const timings: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await caller.readiness.getScore({ frameworkId: fw.id });
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      const p95 = timings[Math.floor(timings.length * 0.95)];
      expect(p95).toBeLessThan(200);

      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }, 30_000);
  });
});
