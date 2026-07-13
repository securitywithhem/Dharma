/**
 * tests/parseCitations.test.ts — Phase 7 Part 3 citation parser (pure, node).
 */
import { describe, it, expect } from "@jest/globals";
import { parseMessageSegments, extractCitations } from "@/lib/ai/parseCitations";

describe("parseMessageSegments", () => {
  it("returns [] for empty input", () => {
    expect(parseMessageSegments("")).toEqual([]);
  });

  it("splits text and citations in order", () => {
    const segs = parseMessageSegments("MFA is enforced [[control:c1]] per policy [[chunk:k9]].");
    expect(segs).toEqual([
      { kind: "text", text: "MFA is enforced " },
      { kind: "citation", type: "control", id: "c1", raw: "[[control:c1]]" },
      { kind: "text", text: " per policy " },
      { kind: "citation", type: "chunk", id: "k9", raw: "[[chunk:k9]]" },
      { kind: "text", text: "." },
    ]);
  });

  it("reproduces the input exactly when concatenating raw segments", () => {
    const input = "a [[control:x1]] b [[evidence:e2]] c";
    const rebuilt = parseMessageSegments(input)
      .map((s) => (s.kind === "text" ? s.text : s.raw))
      .join("");
    expect(rebuilt).toBe(input);
  });

  it("leaves malformed / unknown markers as plain text (never crashes)", () => {
    for (const bad of ["[[control:]]", "[[foo:1]]", "[[control c1]]", "[[control:", "plain text", "[[]]"]) {
      const segs = parseMessageSegments(bad);
      expect(segs.every((s) => s.kind === "text")).toBe(true);
      expect(segs.map((s) => (s as any).text).join("")).toBe(bad);
    }
  });

  it("extractCitations dedupes and preserves order", () => {
    expect(extractCitations("[[control:c1]] x [[chunk:k1]] y [[control:c1]]")).toEqual([
      { type: "control", id: "c1" },
      { type: "chunk", id: "k1" },
    ]);
  });
});
