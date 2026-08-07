import type { MappingStrength } from "@prisma/client";

/**
 * Maps an embedding cosine-similarity score to a cross-walk mapping strength.
 *
 * Shared between the server (controlMapping.proposeForFrameworkPair, which
 * writes these in bulk) and the client (CrossWalkPicker's "Accept suggestion",
 * which pre-selects a strength for a human to confirm). It lives here rather
 * than in the component because two callers deriving the same thresholds
 * independently is a guaranteed drift: a change on one side would silently make
 * bulk proposals disagree with what the picker shows for the same score.
 *
 * The bands themselves are a judgement call, not a measurement — they were
 * chosen for the interactive picker where a human sees the percentage and the
 * suggested strength together. Treat a proposed strength as a starting point
 * for review, never as an assessment.
 */
export function strengthForConfidence(score: number): MappingStrength {
  if (score >= 0.85) return "EQUIVALENT";
  if (score >= 0.6) return "PARTIAL";
  return "RELATED";
}
