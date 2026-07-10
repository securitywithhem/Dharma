import { ControlStatus } from "@prisma/client";
import type { EvidenceItem } from "./types";

/**
 * Derives the next Control status from a batch of auto-collected EvidenceItems.
 *
 * The real ControlStatus enum (packages/db/schema.prisma) is
 * NOT_STARTED | IN_PROGRESS | COMPLIANT | NOT_APPLICABLE — there is no
 * dedicated "failing" status. This policy maps automated check outcomes onto
 * that existing enum rather than inventing a new value, so it doesn't ripple
 * into every place that already renders/aggregates ControlStatus (report
 * generator, control table, dashboard).
 *
 * Rules:
 *   - NOT_APPLICABLE is never touched by automation — the org has explicitly
 *     excluded this control, and an automated check has no authority to
 *     override that.
 *   - Any item with status "fail" => IN_PROGRESS. Unlike the manual
 *     evidence-upload flow (evidence.acceptMapping), which only ever
 *     advances a control forward and never downgrades a COMPLIANT control,
 *     automated re-checks are allowed to downgrade — that's the point of
 *     continuous monitoring: catching a control that regressed after
 *     passing (e.g. someone disabled encryption after we marked it
 *     COMPLIANT).
 *   - All items "pass" (and at least one item) => COMPLIANT.
 *   - Any item "unknown" and no "fail" => no verdict; return null to leave
 *     the existing status unchanged rather than silently downgrading or
 *     advancing it. Callers should treat a null result as "flag for manual
 *     review", not "no evidence collected".
 *   - No items at all => null (nothing to derive from).
 *
 * Phase 6's scoring engine will also read Control.status later — this policy
 * intentionally stays rule-based and decoupled from Phase 6 so it doesn't
 * need to know anything about scoring, only about not contradicting it.
 */
export function deriveControlStatus(
  evidenceItems: EvidenceItem[],
  currentStatus: ControlStatus,
): ControlStatus | null {
  if (currentStatus === ControlStatus.NOT_APPLICABLE) {
    return null;
  }

  if (evidenceItems.length === 0) {
    return null;
  }

  const hasFail = evidenceItems.some((item) => item.status === "fail");
  if (hasFail) {
    return ControlStatus.IN_PROGRESS;
  }

  const allPass = evidenceItems.every((item) => item.status === "pass");
  if (allPass) {
    return ControlStatus.COMPLIANT;
  }

  // Remaining case: no fails, but at least one "unknown" — needs manual review.
  return null;
}
