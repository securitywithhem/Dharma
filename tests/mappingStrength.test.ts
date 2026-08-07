import { describe, it, expect } from "@jest/globals";
import { strengthForConfidence } from "@/lib/mappingStrength";

/**
 * These thresholds are now shared by the server (bulk propose) and the client
 * (the picker's Accept-suggestion dialog). Pinning the boundaries is what stops
 * the two from silently disagreeing about what a given score means.
 */
describe("strengthForConfidence", () => {
  it.each([
    [1.0, "EQUIVALENT"],
    [0.9, "EQUIVALENT"],
    [0.85, "EQUIVALENT"], // inclusive lower bound
    [0.8499, "PARTIAL"],
    [0.7, "PARTIAL"],
    [0.6, "PARTIAL"], // inclusive lower bound
    [0.5999, "RELATED"],
    [0.0, "RELATED"],
  ])("maps %s to %s", (score, expected) => {
    expect(strengthForConfidence(score as number)).toBe(expected);
  });
});
