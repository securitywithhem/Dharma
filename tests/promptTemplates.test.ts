/**
 * tests/promptTemplates.test.ts — Phase 7 Part 2 guardrail + prompt unit tests.
 * Pure functions, no services required.
 */
import { describe, it, expect } from "@jest/globals";
import type { RetrievedContext, ScoredChunk } from "@/server/ai/retrieval";
import {
  SYSTEM_PROMPT,
  REFUSAL_ANSWER,
  INSUFFICIENT_CONTEXT_ANSWER,
  SIMILARITY_DISTANCE_THRESHOLD,
  passingChunks,
  hasInsufficientContext,
  composeUserPrompt,
  buildGapAssessmentPrompt,
  buildPolicyDraftPrompt,
  detectIntent,
  validateOutputScope,
} from "@/server/ai/promptTemplates";

const chunk = (id: string, distance: number, content = "Access control evidence."): ScoredChunk => ({
  id,
  content,
  chunkIndex: 0,
  documentType: "policy_doc",
  documentId: "doc1",
  sourceDocumentId: "doc1",
  graphNodeId: null,
  distance,
});

const ctx = (chunks: ScoredChunk[], liveControls: RetrievedContext["liveControls"] = []): RetrievedContext => ({
  query: "q",
  chunks,
  graphRelations: [],
  liveControls,
});

describe("promptTemplates — guardrails", () => {
  it("SYSTEM_PROMPT embeds the refusal and insufficient-context strings", () => {
    expect(SYSTEM_PROMPT).toContain(REFUSAL_ANSWER);
    expect(SYSTEM_PROMPT).toContain(INSUFFICIENT_CONTEXT_ANSWER);
    expect(SYSTEM_PROMPT).toMatch(/citation/i);
  });

  it("passingChunks keeps only chunks within the distance threshold, sorted", () => {
    const passed = passingChunks([chunk("a", 0.5), chunk("b", 0.1), chunk("c", SIMILARITY_DISTANCE_THRESHOLD)]);
    expect(passed.map((c) => c.id)).toEqual(["b", "c"]); // 0.5 dropped, sorted by distance
  });

  it("hasInsufficientContext is true when no chunk passes and no live controls", () => {
    expect(hasInsufficientContext(ctx([chunk("a", 0.9)]))).toBe(true);
    expect(hasInsufficientContext(ctx([chunk("a", 0.1)]))).toBe(false);
    expect(hasInsufficientContext(ctx([], [{ controlId: "c1", code: "CC6.1", title: "t", status: "COMPLIANT", domain: "d", frameworkId: "f", frameworkName: "SOC 2", mappedTo: [] }]))).toBe(false);
  });
});

describe("promptTemplates — composition", () => {
  it("composeUserPrompt includes the context blocks and citation instruction", () => {
    const prompt = composeUserPrompt("What is our MFA posture?", ctx([chunk("k1", 0.1, "MFA is enforced for admins.")]));
    expect(prompt).toContain("<retrieved_chunks>");
    expect(prompt).toContain("<graph_relations>");
    expect(prompt).toContain("<live_controls>");
    expect(prompt).toContain("MFA is enforced for admins.");
    expect(prompt).toContain('id="k1"');
    expect(prompt).toMatch(/\[\[chunk:ID\]\]/);
    expect(prompt).toContain("What is our MFA posture?");
  });

  it("composeUserPrompt excludes chunks that fail the threshold", () => {
    const prompt = composeUserPrompt("q", ctx([chunk("keep", 0.1, "KEEP THIS"), chunk("drop", 0.9, "DROP THIS")]));
    expect(prompt).toContain("KEEP THIS");
    expect(prompt).not.toContain("DROP THIS");
  });

  it("buildGapAssessmentPrompt produces a structured passing/failing breakdown", () => {
    const p = buildGapAssessmentPrompt("SOC 2", ctx([chunk("k1", 0.1)]));
    expect(p).toMatch(/GAP ASSESSMENT/i);
    expect(p).toMatch(/PASSING/);
    expect(p).toMatch(/FAILING|GAPS/);
    expect(p).toContain("SOC 2");
  });

  it("buildPolicyDraftPrompt asks for a structured policy", () => {
    const p = buildPolicyDraftPrompt("access control", ctx([chunk("k1", 0.1)]));
    expect(p).toMatch(/Purpose/);
    expect(p).toMatch(/Scope/);
    expect(p).toContain("access control");
  });
});

describe("promptTemplates — intent detection", () => {
  it("detects gap assessment", () => {
    expect(detectIntent("Generate a gap analysis against SOC2 CC6")).toBe("gap_assessment");
    expect(detectIntent("show me the gaps for ISO 27001")).toBe("gap_assessment");
  });
  it("detects policy draft", () => {
    expect(detectIntent("Draft a policy for access control")).toBe("policy_draft");
    expect(detectIntent("write a policy for data retention")).toBe("policy_draft");
  });
  it("defaults to qa", () => {
    expect(detectIntent("What controls do we have for encryption?")).toBe("qa");
  });
});

describe("promptTemplates — output scope validation", () => {
  it("does not flag clean compliance answers", () => {
    const v = validateOutputScope("Control CC6.1 is COMPLIANT based on the access review evidence [[control:c1]].");
    expect(v.flagged).toBe(false);
    expect(v.reasons).toHaveLength(0);
  });

  it("flags out-of-domain code blocks", () => {
    const v = validateOutputScope("Sure, here is a script:\n```python\nfor i in range(10): print(i)\n```");
    expect(v.flagged).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/code block/i);
  });

  it("flags a response that claims insufficient info yet answers substantively", () => {
    const long = "X".repeat(300);
    const v = validateOutputScope(`${INSUFFICIENT_CONTEXT_ANSWER} However, ${long}`);
    expect(v.flagged).toBe(true);
  });
});
