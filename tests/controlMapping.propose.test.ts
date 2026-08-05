import { describe, it, expect, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// Slim router — importing appRouter would construct every BullMQ queue (and
// their Redis connections) at module load. Same rationale as
// tests/controlMapping.hierarchy.test.ts.
// eslint-disable-next-line import/first
import { controlMappingRouter } from "@/server/routers/controlMapping";
// eslint-disable-next-line import/first
import { computeReadinessScore } from "@/server/services/readinessScoring";

const testRouter = createTRPCRouter({ controlMapping: controlMappingRouter });
const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  return createCallerFactory(testRouter)({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: uid, email: "t@example.com", name: "T", organizationId: orgId, role },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  } as never);
}

let seq = 0;
const uniq = (s: string) => `${s}-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 7)}`;

async function seedOrg(label: string) {
  const org = await prisma.organization.create({ data: { name: uniq(label) } });
  const user = await prisma.user.create({
    data: { email: `${uniq(label)}@propose.test`, organizationId: org.id, role: Role.ADMIN },
  });
  return { org, user };
}

const DIM = 384;

/**
 * A unit vector at a known angle in the plane spanned by axes 0 and 1.
 * `theta = 0` is identical to the reference vector (cosine 1.0); `PI/2` is
 * orthogonal (cosine 0).
 *
 * Writing embeddings directly rather than calling Ollama is deliberate: it
 * removes a network dependency from the whole suite AND makes the
 * minConfidence boundary exactly assertable, which a real model's output never
 * would be.
 */
function unitVector(theta: number): number[] {
  const v = new Array(DIM).fill(0);
  v[0] = Math.cos(theta);
  v[1] = Math.sin(theta);
  return v;
}

async function writeEmbedding(controlId: string, vector: number[]) {
  // Raw SQL: Control.embedding is Unsupported("vector(384)"), so Prisma cannot
  // write it through the client.
  await prisma.$executeRawUnsafe(
    `UPDATE "Control" SET embedding = $1::vector, "embeddingStatus" = 'SUCCESS' WHERE id = $2`,
    `[${vector.join(",")}]`,
    controlId,
  );
}

async function makeControl(frameworkId: string, title: string, domain = "General") {
  return prisma.control.create({
    data: { frameworkId, domain, title, description: title, status: "NOT_STARTED" },
  });
}

/**
 * Standard fixture: framework A with one leaf, framework B with an identical
 * match, a mid-confidence match, and an orthogonal distractor.
 */
async function seedPair(label: string) {
  const { org, user } = await seedOrg(label);
  const fwA = await prisma.framework.create({ data: { name: uniq("FW-A"), organizationId: org.id } });
  const fwB = await prisma.framework.create({ data: { name: uniq("FW-B"), organizationId: org.id } });

  const source = await makeControl(fwA.id, "Source control");
  const exact = await makeControl(fwB.id, "Exact match");
  const mid = await makeControl(fwB.id, "Mid match");
  const distractor = await makeControl(fwB.id, "Unrelated");

  await writeEmbedding(source.id, unitVector(0));
  await writeEmbedding(exact.id, unitVector(0)); // cosine 1.0
  await writeEmbedding(mid.id, unitVector(Math.PI / 4)); // cosine ~0.707
  await writeEmbedding(distractor.id, unitVector(Math.PI / 2)); // cosine 0

  return { org, user, fwA, fwB, source, exact, mid, distractor };
}

describe("controlMapping.proposeForFrameworkPair", () => {
  it("writes PROPOSED rows only, and only above the confidence threshold", async () => {
    const f = await seedPair("ProposeBasic");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      const result = await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });

      expect(result.proposed).toBe(1);
      expect(result.unembedded).toBe(0);

      const rows = await prisma.controlMapping.findMany({ where: { organizationId: f.org.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("PROPOSED");
      expect(rows[0].suggestedByAI).toBe(true);
      expect(rows[0].targetControlId).toBe(f.exact.id);
      // cosine 1.0 -> EQUIVALENT per strengthForConfidence
      expect(rows[0].mappingStrength).toBe("EQUIVALENT");

      // The 0.707 and 0.0 candidates are both below 0.8 and must not appear.
      const targets = rows.map((r) => r.targetControlId);
      expect(targets).not.toContain(f.mid.id);
      expect(targets).not.toContain(f.distractor.id);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("includes the mid-confidence match when the threshold is lowered", async () => {
    const f = await seedPair("ProposeThreshold");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      const result = await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.5,
      });

      expect(result.proposed).toBe(2);
      const rows = await prisma.controlMapping.findMany({ where: { organizationId: f.org.id } });
      const mid = rows.find((r) => r.targetControlId === f.mid.id);
      expect(mid).toBeDefined();
      // cosine ~0.707 sits in the PARTIAL band (>=0.6, <0.85).
      expect(mid?.mappingStrength).toBe("PARTIAL");
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("is idempotent — a second run proposes nothing new", async () => {
    const f = await seedPair("ProposeIdempotent");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      const args = { sourceFrameworkId: f.fwA.id, targetFrameworkId: f.fwB.id, minConfidence: 0.8 };

      const first = await caller.controlMapping.proposeForFrameworkPair(args);
      const second = await caller.controlMapping.proposeForFrameworkPair(args);

      expect(first.proposed).toBe(1);
      expect(second.proposed).toBe(0);
      expect(second.skippedExisting).toBeGreaterThan(0);
      expect(await prisma.controlMapping.count({ where: { organizationId: f.org.id } })).toBe(1);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("does not propose a pair that already exists in the REVERSE direction", async () => {
    const f = await seedPair("ProposeReverse");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      // A human maps B -> A. Propose scans A -> B and must recognise the pair.
      await prisma.controlMapping.create({
        data: {
          organizationId: f.org.id,
          sourceControlId: f.exact.id,
          targetControlId: f.source.id,
          mappingStrength: "EQUIVALENT",
          createdById: f.user.id,
          status: "ACCEPTED",
        },
      });

      const result = await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });

      expect(result.proposed).toBe(0);
      expect(await prisma.controlMapping.count({ where: { organizationId: f.org.id } })).toBe(1);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("never re-proposes a pair a human REJECTED", async () => {
    const f = await seedPair("ProposeRejected");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      const args = { sourceFrameworkId: f.fwA.id, targetFrameworkId: f.fwB.id, minConfidence: 0.8 };

      await caller.controlMapping.proposeForFrameworkPair(args);
      const proposal = await prisma.controlMapping.findFirstOrThrow({
        where: { organizationId: f.org.id, status: "PROPOSED" },
      });
      await caller.controlMapping.review({ id: proposal.id, decision: "REJECTED" });

      const rerun = await caller.controlMapping.proposeForFrameworkPair(args);
      expect(rerun.proposed).toBe(0);

      const rows = await prisma.controlMapping.findMany({ where: { organizationId: f.org.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("REJECTED");
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("reports controls that have no embedding instead of silently finding nothing", async () => {
    const f = await seedPair("ProposeUnembedded");
    try {
      // A second source leaf with no embedding at all.
      await makeControl(f.fwA.id, "Never embedded");

      const caller = createCaller(f.org.id, f.user.id);
      const result = await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
      });

      expect(result.unembedded).toBe(1);
      expect(result.scanned).toBe(1);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("enforces tenant isolation", async () => {
    const f = await seedPair("ProposeIsolationA");
    const other = await seedOrg("ProposeIsolationB");
    try {
      const caller = createCaller(other.org.id, other.user.id);
      await expect(
        caller.controlMapping.proposeForFrameworkPair({
          sourceFrameworkId: f.fwA.id,
          targetFrameworkId: f.fwB.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
      await prisma.organization.delete({ where: { id: other.org.id } }).catch(() => undefined);
    }
  });

  // ------------------------------------------------------------------
  // The headline guarantee.
  // ------------------------------------------------------------------
  it("does NOT move the readiness score until a human accepts", async () => {
    const f = await seedPair("ProposeScoreGate");
    try {
      // Give the target real evidence so an ACCEPTED mapping would earn the
      // source control mapping credit — i.e. the score CAN move here.
      await prisma.evidence.create({
        data: {
          organizationId: f.org.id,
          controlId: f.exact.id,
          fileName: "evidence.pdf",
          filePath: "x",
          type: "POLICY_DOC",
          collectedAt: new Date(),
        },
      });

      const before = await computeReadinessScore(prisma, f.org.id, f.fwA.id);

      const caller = createCaller(f.org.id, f.user.id);
      await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });

      const afterPropose = await computeReadinessScore(prisma, f.org.id, f.fwA.id);
      expect(afterPropose.overallScore).toBe(before.overallScore);
      expect(afterPropose.mappingBonus).toBe(before.mappingBonus);

      // Accepting the same proposal releases the credit — proving the fixture
      // was capable of moving all along, and the gate is the status field.
      const proposal = await prisma.controlMapping.findFirstOrThrow({
        where: { organizationId: f.org.id, status: "PROPOSED" },
      });
      await caller.controlMapping.review({ id: proposal.id, decision: "ACCEPTED" });

      const afterAccept = await computeReadinessScore(prisma, f.org.id, f.fwA.id);
      expect(afterAccept.mappingBonus).toBeGreaterThan(before.mappingBonus);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("refuses to review the same proposal twice", async () => {
    const f = await seedPair("ProposeDoubleReview");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });
      const proposal = await prisma.controlMapping.findFirstOrThrow({
        where: { organizationId: f.org.id, status: "PROPOSED" },
      });

      await caller.controlMapping.review({ id: proposal.id, decision: "ACCEPTED" });
      await expect(
        caller.controlMapping.review({ id: proposal.id, decision: "REJECTED" }),
      ).rejects.toThrow(/already been reviewed/i);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("keeps proposals out of the picker's mapped set (listForFrameworkPair)", async () => {
    const f = await seedPair("ProposeUnmapped");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });

      const pair = await caller.controlMapping.listForFrameworkPair({
        frameworkAId: f.fwA.id,
        frameworkBId: f.fwB.id,
      });

      // The proposed control is still UNMAPPED — a suggestion nobody accepted
      // must not hide the control from the list of work remaining.
      expect(pair.mappings).toHaveLength(0);
      expect(pair.proposals).toHaveLength(1);
      expect(pair.unmappedA.map((c) => c.id)).toContain(f.source.id);
      expect(pair.unmappedB.map((c) => c.id)).toContain(f.exact.id);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("counts proposals separately from coverage in the overlap matrix", async () => {
    const f = await seedPair("ProposeMatrix");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.8,
      });

      const matrix = await caller.controlMapping.getOverlapMatrix({
        frameworkAId: f.fwA.id,
        frameworkBId: f.fwB.id,
      });

      expect(matrix.proposedTotal).toBe(1);
      const cell = matrix.cells[0];
      expect(cell.proposedCount).toBe(1);
      // Coverage must stay at zero — the colour ramp encodes agreed coverage.
      expect(cell.mappingCount).toBe(0);
      expect(cell.coveragePct).toBe(0);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });

  it("groups the matrix by DOMAIN when controls have no materialized path", async () => {
    // Pre-fix this produced one family per control, labelled with the control's
    // title — the degenerate ~100-column grid with truncated headers.
    const { org, user } = await seedOrg("ProposeDomainFamily");
    try {
      const fwA = await prisma.framework.create({ data: { name: uniq("FW-A"), organizationId: org.id } });
      const fwB = await prisma.framework.create({ data: { name: uniq("FW-B"), organizationId: org.id } });

      await makeControl(fwA.id, "A1", "Access Control");
      await makeControl(fwA.id, "A2", "Access Control");
      await makeControl(fwA.id, "A3", "Cryptography");
      await makeControl(fwB.id, "B1", "Governance");

      const matrix = await createCaller(org.id, user.id).controlMapping.getOverlapMatrix({
        frameworkAId: fwA.id,
        frameworkBId: fwB.id,
      });

      expect(matrix.familiesA).toHaveLength(2);
      const names = matrix.familiesA.map((f) => f.familyName).sort();
      expect(names).toEqual(["Access Control", "Cryptography"]);
      const accessControl = matrix.familiesA.find((f) => f.familyName === "Access Control");
      expect(accessControl?.totalControls).toBe(2);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    }
  });

  it("bulkReview accepts many proposals and ignores foreign or already-reviewed ids", async () => {
    const f = await seedPair("ProposeBulk");
    try {
      const caller = createCaller(f.org.id, f.user.id);
      await caller.controlMapping.proposeForFrameworkPair({
        sourceFrameworkId: f.fwA.id,
        targetFrameworkId: f.fwB.id,
        minConfidence: 0.5, // pick up both the exact and mid matches
      });
      const proposals = await prisma.controlMapping.findMany({
        where: { organizationId: f.org.id, status: "PROPOSED" },
      });
      expect(proposals.length).toBe(2);

      const result = await caller.controlMapping.bulkReview({
        ids: [...proposals.map((p) => p.id), "does-not-exist"],
        decision: "ACCEPTED",
      });

      expect(result.reviewed).toBe(2);
      expect(
        await prisma.controlMapping.count({ where: { organizationId: f.org.id, status: "ACCEPTED" } }),
      ).toBe(2);

      // Re-reviewing is a no-op rather than an error.
      const again = await caller.controlMapping.bulkReview({
        ids: proposals.map((p) => p.id),
        decision: "REJECTED",
      });
      expect(again.reviewed).toBe(0);
    } finally {
      await prisma.organization.delete({ where: { id: f.org.id } }).catch(() => undefined);
    }
  });
});
