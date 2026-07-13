/**
 * tests/evidenceAutoTag.test.ts — Phase 7 Part 3 evidence auto-tag worker.
 *
 * CRITICAL invariant under test: auto-tagging NEVER silently commits an
 * association — it only writes suggestions, and never touches Evidence.controlId.
 */

// Prevent the queue module (imported transitively) from opening a real Redis conn.
jest.mock("@/server/queue/evidenceAutoTagQueue", () => ({
  EVIDENCE_AUTO_TAG_QUEUE_NAME: "evidence-auto-tag",
  evidenceAutoTagQueue: { add: jest.fn() },
  enqueueEvidenceAutoTag: jest.fn(),
}));

import { processEvidenceAutoTag, type SuggestedControl } from "@/server/queue/workers/evidenceAutoTagWorker";

function makeFakePrisma(evidence: any) {
  const updates: any[] = [];
  const prisma = {
    evidence: {
      findUnique: jest.fn(async () => evidence),
      update: jest.fn(async ({ data }: any) => {
        updates.push(data);
        return {};
      }),
    },
    __updates: updates,
  };
  return prisma;
}

const baseEvidence = {
  id: "e1",
  organizationId: "o1",
  controlId: "c1",
  fileName: "screenshot.png",
  filePath: "key-1",
  type: "SCREENSHOT",
};

const deps = (suggestions: SuggestedControl[]) => ({
  getBuffer: async () => Buffer.from("dummy"),
  extractText: async () => "This document describes multi-factor authentication and access review evidence in detail.",
  embed: async () => Array.from({ length: 384 }, () => 0.05),
  findSimilarControls: async () => suggestions,
});

describe("processEvidenceAutoTag", () => {
  it("writes suggestions and NEVER modifies the evidence's real controlId", async () => {
    const prisma = makeFakePrisma({ ...baseEvidence });
    const suggestions: SuggestedControl[] = [
      { controlId: "c2", code: "CC7.2", title: "Logging", confidence: 0.9 },
      { controlId: "c3", code: "CC6.1", title: "Access", confidence: 0.7 },
    ];
    const res = await processEvidenceAutoTag(prisma as any, "e1", deps(suggestions));

    expect(res.suggestions).toHaveLength(2);
    // Every update call must be suggestion-only — never a controlId re-assignment.
    for (const data of prisma.__updates) {
      expect(data).not.toHaveProperty("controlId");
    }
    const suggestUpdate = prisma.__updates.find((d) => "suggestedControlIds" in d);
    expect(suggestUpdate.autoTagStatus).toBe("SUGGESTED");
    expect(suggestUpdate.autoTagConfidence).toBe(0.9);
    expect((suggestUpdate.suggestedControlIds as SuggestedControl[]).map((s) => s.controlId)).toEqual(["c2", "c3"]);
  });

  it("drops suggestions below the confidence threshold", async () => {
    const prisma = makeFakePrisma({ ...baseEvidence });
    await processEvidenceAutoTag(prisma as any, "e1", deps([{ controlId: "c9", code: null, title: "x", confidence: 0.3 }]));
    const suggestUpdate = prisma.__updates.find((d) => "suggestedControlIds" in d);
    expect(suggestUpdate.suggestedControlIds).toHaveLength(0);
  });

  it("excludes the already-assigned control from similarity search", async () => {
    const prisma = makeFakePrisma({ ...baseEvidence });
    const find = jest.fn(async () => [] as SuggestedControl[]);
    await processEvidenceAutoTag(prisma as any, "e1", { ...deps([]), findSimilarControls: find });
    expect(find).toHaveBeenCalledWith("o1", expect.any(Array), "c1");
  });

  it("marks SUGGESTED with no suggestions when text is too short to embed", async () => {
    const prisma = makeFakePrisma({ ...baseEvidence });
    const embed = jest.fn();
    await processEvidenceAutoTag(prisma as any, "e1", { ...deps([]), extractText: async () => "tiny", embed: embed as any });
    expect(embed).not.toHaveBeenCalled();
    const last = prisma.__updates[prisma.__updates.length - 1];
    expect(last.autoTagStatus).toBe("SUGGESTED");
    expect(last.suggestedControlIds).toEqual([]);
  });

  it("sets FAILED (non-fatal) on error and still never sets controlId", async () => {
    const prisma = makeFakePrisma({ ...baseEvidence });
    await processEvidenceAutoTag(prisma as any, "e1", {
      ...deps([]),
      getBuffer: async () => {
        throw new Error("MinIO down");
      },
    });
    const last = prisma.__updates[prisma.__updates.length - 1];
    expect(last.autoTagStatus).toBe("FAILED");
    for (const data of prisma.__updates) expect(data).not.toHaveProperty("controlId");
  });
});
