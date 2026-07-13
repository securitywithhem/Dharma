/**
 * tests/chunking.test.ts — Phase 7 Part 1 unit tests for the document chunker.
 * Pure function, no external services required.
 */
import { describe, it, expect } from "@jest/globals";
import { chunkDocument, estimateTokens } from "@/server/ai/chunking";

const SENTENCE_TERMINATORS = /[.!?]$/;

describe("chunkDocument", () => {
  it("returns an empty array for empty / whitespace-only input", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  \t ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const text = "Access control is enforced. MFA is required for all admins.";
    const chunks = chunkDocument(text, { maxTokens: 512, overlapTokens: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toContain("Access control");
    expect(chunks[0].tokenEstimate).toBe(estimateTokens(chunks[0].content));
  });

  it("splits a long document into multiple sequentially-indexed chunks", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} describes a compliance control and its evidence.`,
    );
    const text = sentences.join(" ");
    const chunks = chunkDocument(text, { maxTokens: 50, overlapTokens: 15 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Every chunk should be at/near the budget (allowing overlap slack).
    chunks.forEach((c) => expect(c.tokenEstimate).toBeLessThanOrEqual(50 + 15 + 20));
  });

  it("never splits mid-sentence for normal prose (each chunk ends on a terminator)", () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Policy statement ${i} covers access restrictions and data principal rights.`,
    );
    const chunks = chunkDocument(sentences.join(" "), { maxTokens: 40, overlapTokens: 10 });
    for (const c of chunks) {
      expect(c.content.trim()).toMatch(SENTENCE_TERMINATORS);
    }
  });

  it("produces overlapping chunks — a boundary sentence appears in both neighbours", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Unique marker ${i} sentence here.`);
    const chunks = chunkDocument(sentences.join(" "), { maxTokens: 40, overlapTokens: 12 });
    expect(chunks.length).toBeGreaterThan(2);

    let foundOverlap = false;
    for (let i = 0; i < chunks.length - 1; i++) {
      // The last "Unique marker N" of chunk i should reappear at the start of i+1.
      const markers = chunks[i].content.match(/Unique marker \d+/g) ?? [];
      const lastMarker = markers[markers.length - 1];
      if (lastMarker && chunks[i + 1].content.includes(lastMarker)) {
        foundOverlap = true;
        break;
      }
    }
    expect(foundOverlap).toBe(true);
  });

  it("hard-splits a single sentence that exceeds maxTokens (only allowed mid-sentence case)", () => {
    // One sentence, no terminators, ~1000 chars ≈ 250 tokens, into maxTokens=50 (≈200 chars) windows.
    const huge = "word ".repeat(200).trim() + "."; // ~1000 chars, single sentence
    const chunks = chunkDocument(huge, { maxTokens: 50, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk grossly exceeds the char budget of one window.
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(50 * 4 + 4);
    }
  });

  it("does not loop when overlapTokens >= maxTokens (clamped internally)", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Fact ${i} is stated clearly.`).join(" ");
    const chunks = chunkDocument(text, { maxTokens: 20, overlapTokens: 100 });
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });
});
