import { describe, it, expect } from "@jest/globals";
import { Severity } from "@prisma/client";
import { calculateCvssScore, severityFromScore, InvalidCvssVectorError } from "@/server/pentest/cvss";

describe("cvss — calculateCvssScore", () => {
  // These three vectors and their base scores are FIRST.org's own published
  // CVSS v3.1 specification examples (Section 8, "Examples"), not invented
  // values — https://www.first.org/cvss/v3.1/specification-document
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8, Severity.CRITICAL],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", 10.0, Severity.CRITICAL],
    ["CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:N", 2.7, Severity.LOW],
  ])("scores %s as %f (%s)", (vector, expectedScore, expectedSeverity) => {
    const result = calculateCvssScore(vector);
    expect(result.score).toBeCloseTo(expectedScore, 1);
    expect(result.severity).toBe(expectedSeverity);
  });

  it("accepts a vector without the CVSS:3.1/ prefix and normalizes it", () => {
    const result = calculateCvssScore("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
    expect(result.vector).toBe("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H");
    expect(result.score).toBeCloseTo(9.8, 1);
  });

  it("throws InvalidCvssVectorError for a vector missing base metrics", () => {
    expect(() => calculateCvssScore("CVSS:3.1/AV:N/AC:L")).toThrow(InvalidCvssVectorError);
  });

  it("throws InvalidCvssVectorError for garbage input", () => {
    expect(() => calculateCvssScore("not a vector at all")).toThrow(InvalidCvssVectorError);
  });
});

describe("cvss — severityFromScore", () => {
  it.each([
    [0, Severity.NONE],
    [0.1, Severity.LOW],
    [3.9, Severity.LOW],
    [4.0, Severity.MEDIUM],
    [6.9, Severity.MEDIUM],
    [7.0, Severity.HIGH],
    [8.9, Severity.HIGH],
    [9.0, Severity.CRITICAL],
    [10.0, Severity.CRITICAL],
  ])("maps score %f to %s", (score, expected) => {
    expect(severityFromScore(score)).toBe(expected);
  });
});
