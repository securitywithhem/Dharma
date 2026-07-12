/**
 * src/server/services/readinessScoring.ts
 *
 * Phase 6 Part 3 — Audit Readiness Score & recommendation engine.
 *
 * Ground-truth note: the Evidence model has NO acceptance/approval status
 * enum (verified directly against packages/db/schema.prisma — its only
 * status-like field is `embeddingStatus`, which tracks embedding computation,
 * not evidence quality). "Acceptable evidence" here means a control has at
 * least one Evidence row that isn't expired (`expiresAt IS NULL OR
 * expiresAt > now()`) — the only real, meaningful acceptance signal the
 * schema actually has.
 *
 * Scoring formula (bounded to [0, 100] by construction):
 *   evidenceScore = (evidencedLeaves / totalLeaves) * 85
 *   mappingBonus  = min(15, (creditSum / totalLeaves) * 15)
 *     where credit only accrues to EVIDENCE-LESS leaves mapped
 *     (EQUIVALENT = 1.0, PARTIAL = 0.5) to an evidenced control in a
 *     DIFFERENT framework — so evidencedFraction + creditFraction <= 1
 *     always, and overallScore = evidenceScore + mappingBonus <= 100.
 *
 * SQL/app split: one raw SQL query (loadLeafFacts) does the expensive
 * per-control existence/expiry/mapping joins in a single pass — this is the
 * part that matters for the p95 target, since it returns at most
 * `totalLeafControls` rows regardless of framework size. Family grouping and
 * score/recommendation composition happen in TypeScript, where the branching
 * logic is far more readable and unit-testable than as nested SQL CASE
 * expressions. This mirrors Part 2's getOverlapMatrix.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import { RecommendationStatus, RecommendationType } from "@prisma/client";

const STALE_EVIDENCE_DAYS = 90;
const FAMILY_LOW_COVERAGE_THRESHOLD = 50;
const UNMAPPED_HIGH_VALUE_FAMILY_THRESHOLD = 70;
const MISSING_EVIDENCE_CAP = 20;
/** How much potentialScoreGain must differ from a DISMISSED entry's before the gap is considered to have "changed materially" and the recommendation is re-surfaced. */
const MATERIAL_GAIN_DELTA = 5;

interface LeafFact {
  id: string;
  path: Prisma.JsonValue;
  title: string;
  code: string | null;
  hasEvidence: boolean;
  latestEvidenceAt: Date | null;
  hasAnyMapping: boolean;
  bestStrengthRank: number | null; // 3=EQUIVALENT, 2=PARTIAL, 1=RELATED, null=none
  mappingCredit: number; // 0, 0.5, or 1.0 — only non-zero when hasEvidence is false
}

function familyIdFor(path: Prisma.JsonValue, ownId: string): string {
  return Array.isArray(path) && path.length > 0 ? (path[0] as string) : ownId;
}

/**
 * Loads the per-leaf-control facts needed by both computeReadinessScore and
 * generateRecommendations, in one raw SQL pass, plus a lightweight
 * family-label lookup (depth-0 control titles).
 */
async function loadLeafFacts(
  prisma: PrismaClient,
  organizationId: string,
  frameworkId: string,
): Promise<{ leaves: LeafFact[]; familyLabels: Map<string, string> }> {
  const [leaves, roots] = await Promise.all([
    prisma.$queryRawUnsafe<LeafFact[]>(
      `WITH leaves AS (
         SELECT c.id, c.path, c.title, c.code
         FROM "Control" c
         WHERE c."frameworkId" = $1
           AND NOT EXISTS (SELECT 1 FROM "Control" ch WHERE ch."parentId" = c.id)
       ),
       evidence_agg AS (
         SELECT
           e."controlId" AS id,
           bool_or(e."expiresAt" IS NULL OR e."expiresAt" > now()) AS "hasEvidence",
           MAX(e."collectedAt") FILTER (WHERE e."expiresAt" IS NULL OR e."expiresAt" > now()) AS "latestEvidenceAt"
         FROM "Evidence" e
         GROUP BY e."controlId"
       ),
       mapping_agg AS (
         SELECT
           l.id,
           true AS "hasAnyMapping",
           MAX(
             CASE cm."mappingStrength"
               WHEN 'EQUIVALENT' THEN 3
               WHEN 'PARTIAL' THEN 2
               WHEN 'RELATED' THEN 1
               ELSE 0
             END
           ) AS "bestStrengthRank",
           MAX(
             CASE
               WHEN cm."mappingStrength" IN ('EQUIVALENT', 'PARTIAL') AND other_ev."hasEvidence" THEN
                 CASE cm."mappingStrength" WHEN 'EQUIVALENT' THEN 1.0 WHEN 'PARTIAL' THEN 0.5 ELSE 0 END
               ELSE 0
             END
           )::float8 AS "mappingCredit"
         FROM leaves l
         JOIN "ControlMapping" cm
           ON (cm."sourceControlId" = l.id OR cm."targetControlId" = l.id)
          AND cm."organizationId" = $2
         JOIN "Control" other
           ON other.id = CASE WHEN cm."sourceControlId" = l.id THEN cm."targetControlId" ELSE cm."sourceControlId" END
          AND other."frameworkId" != $1
         LEFT JOIN evidence_agg other_ev ON other_ev.id = other.id
         GROUP BY l.id
       )
       SELECT
         l.id, l.path, l.title, l.code,
         COALESCE(ea."hasEvidence", false) AS "hasEvidence",
         ea."latestEvidenceAt",
         COALESCE(ma."hasAnyMapping", false) AS "hasAnyMapping",
         ma."bestStrengthRank",
         COALESCE(ma."mappingCredit", 0)::float8 AS "mappingCredit"
       FROM leaves l
       LEFT JOIN evidence_agg ea ON ea.id = l.id
       LEFT JOIN mapping_agg ma ON ma.id = l.id`,
      frameworkId,
      organizationId,
    ),
    prisma.control.findMany({
      where: { frameworkId, depth: 0 },
      select: { id: true, title: true },
    }),
  ]);

  const familyLabels = new Map<string, string>();
  for (const r of roots) familyLabels.set(r.id, r.title);

  return { leaves, familyLabels };
}

export interface FamilyBreakdown {
  familyId: string;
  familyName: string;
  totalLeaves: number;
  evidencedLeaves: number;
  mappingCreditSum: number;
  familyScore: number;
}

export interface ScoreBreakdown {
  totalLeaves: number;
  evidencedLeaves: number;
  mappingCreditSum: number;
  families: FamilyBreakdown[];
}

export interface ReadinessResult {
  overallScore: number;
  evidenceScore: number;
  mappingBonus: number;
  breakdown: ScoreBreakdown;
}

function scoreFrom(evidencedLeaves: number, mappingCreditSum: number, totalLeaves: number) {
  if (totalLeaves === 0) {
    return { overallScore: 0, evidenceScore: 0, mappingBonus: 0 };
  }
  const evidenceScore = Math.round((evidencedLeaves / totalLeaves) * 85 * 10) / 10;
  const mappingBonus = Math.round(Math.min(15, (mappingCreditSum / totalLeaves) * 15) * 10) / 10;
  return { overallScore: Math.round((evidenceScore + mappingBonus) * 10) / 10, evidenceScore, mappingBonus };
}

/**
 * Computes and upserts the Audit Readiness Score for a framework. Callers
 * must have already verified `frameworkId` belongs to `organizationId` —
 * this function trusts its inputs (invoked from the BullMQ worker / a
 * pre-scoped router procedure, never directly from user input).
 */
export async function computeReadinessScore(
  prisma: PrismaClient,
  organizationId: string,
  frameworkId: string,
): Promise<ReadinessResult> {
  const { leaves, familyLabels } = await loadLeafFacts(prisma, organizationId, frameworkId);

  const byFamily = new Map<string, { totalLeaves: number; evidencedLeaves: number; mappingCreditSum: number }>();
  let totalLeaves = 0;
  let evidencedLeaves = 0;
  let mappingCreditSum = 0;

  for (const leaf of leaves) {
    const famId = familyIdFor(leaf.path, leaf.id);
    const bucket = byFamily.get(famId) ?? { totalLeaves: 0, evidencedLeaves: 0, mappingCreditSum: 0 };
    bucket.totalLeaves += 1;
    totalLeaves += 1;
    if (leaf.hasEvidence) {
      bucket.evidencedLeaves += 1;
      evidencedLeaves += 1;
    } else {
      // Credit only ever applies to evidence-less leaves — see module doc.
      bucket.mappingCreditSum += leaf.mappingCredit;
      mappingCreditSum += leaf.mappingCredit;
    }
    byFamily.set(famId, bucket);
  }

  const families: FamilyBreakdown[] = Array.from(byFamily.entries()).map(([familyId, b]) => {
    const s = scoreFrom(b.evidencedLeaves, b.mappingCreditSum, b.totalLeaves);
    return {
      familyId,
      familyName: familyLabels.get(familyId) ?? familyId,
      totalLeaves: b.totalLeaves,
      evidencedLeaves: b.evidencedLeaves,
      mappingCreditSum: b.mappingCreditSum,
      familyScore: s.overallScore,
    };
  });

  const overall = scoreFrom(evidencedLeaves, mappingCreditSum, totalLeaves);

  const breakdown: ScoreBreakdown = { totalLeaves, evidencedLeaves, mappingCreditSum, families };

  await prisma.readinessScore.upsert({
    where: { organizationId_frameworkId: { organizationId, frameworkId } },
    create: {
      organizationId,
      frameworkId,
      overallScore: overall.overallScore,
      evidenceScore: overall.evidenceScore,
      mappingBonus: overall.mappingBonus,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
    },
    update: {
      overallScore: overall.overallScore,
      evidenceScore: overall.evidenceScore,
      mappingBonus: overall.mappingBonus,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
      computedAt: new Date(),
    },
  });

  return { ...overall, breakdown };
}

interface DraftRecommendation {
  controlId: string | null;
  type: RecommendationType;
  title: string;
  description: string;
  potentialScoreGain: number | null;
}

/**
 * Rule-based recommendations, generated from the same leaf facts the score
 * uses so the two never disagree about what's missing. Replaces OPEN
 * recommendations for this framework inside a transaction; DISMISSED (and
 * IN_PROGRESS/RESOLVED) rows are left untouched unless the underlying gap's
 * potentialScoreGain has shifted by more than MATERIAL_GAIN_DELTA points,
 * in which case a fresh OPEN entry is re-surfaced alongside the old one.
 */
export async function generateRecommendations(
  prisma: PrismaClient,
  organizationId: string,
  frameworkId: string,
): Promise<void> {
  const { leaves, familyLabels } = await loadLeafFacts(prisma, organizationId, frameworkId);
  const totalLeaves = leaves.length;
  if (totalLeaves === 0) {
    await prisma.recommendation.deleteMany({ where: { organizationId, frameworkId, status: RecommendationStatus.OPEN } });
    return;
  }

  // Family aggregates (for FAMILY_LOW_COVERAGE and the <70% gate on
  // UNMAPPED_HIGH_VALUE_CONTROL) — same grouping as computeReadinessScore.
  const byFamily = new Map<string, { totalLeaves: number; evidencedLeaves: number; mappingCreditSum: number }>();
  for (const leaf of leaves) {
    const famId = familyIdFor(leaf.path, leaf.id);
    const bucket = byFamily.get(famId) ?? { totalLeaves: 0, evidencedLeaves: 0, mappingCreditSum: 0 };
    bucket.totalLeaves += 1;
    if (leaf.hasEvidence) bucket.evidencedLeaves += 1;
    else bucket.mappingCreditSum += leaf.mappingCredit;
    byFamily.set(famId, bucket);
  }
  const familyScore = new Map<string, number>();
  for (const [famId, b] of byFamily.entries()) {
    familyScore.set(famId, scoreFrom(b.evidencedLeaves, b.mappingCreditSum, b.totalLeaves).overallScore);
  }

  const drafts: DraftRecommendation[] = [];
  const staleCutoff = new Date(Date.now() - STALE_EVIDENCE_DAYS * 24 * 60 * 60 * 1000);

  // FAMILY_LOW_COVERAGE — one per underperforming family. controlId points at
  // the family's root control (famId is always a real Control id — see
  // familyIdFor) rather than null: with multiple low-coverage families in the
  // same framework, a null controlId would make every one of them share the
  // same "null:FAMILY_LOW_COVERAGE" dismiss-preservation key below, so
  // dismissing one family's recommendation could incorrectly suppress or
  // mismatch a completely different family's.
  for (const [famId, b] of byFamily.entries()) {
    const score = familyScore.get(famId)!;
    if (score < FAMILY_LOW_COVERAGE_THRESHOLD) {
      const neededLeaves = Math.max(0, Math.ceil(b.totalLeaves * 0.5) - b.evidencedLeaves);
      drafts.push({
        controlId: famId,
        type: RecommendationType.FAMILY_LOW_COVERAGE,
        title: `${familyLabels.get(famId) ?? famId} is below 50% coverage`,
        description: `This family has ${b.evidencedLeaves}/${b.totalLeaves} leaf controls with evidence (score ${score}%). Add evidence for ${neededLeaves} more control(s) to clear the 50% threshold.`,
        potentialScoreGain: Math.round(((neededLeaves * 85) / totalLeaves) * 10) / 10,
      });
    }
  }

  const missingEvidenceCandidates: DraftRecommendation[] = [];
  for (const leaf of leaves) {
    const famId = familyIdFor(leaf.path, leaf.id);
    const famScore = familyScore.get(famId)!;
    const label = leaf.code ? `${leaf.code} — ${leaf.title}` : leaf.title;

    // STALE_EVIDENCE — currently counted (non-expired) but aging; informational,
    // doesn't change the current score, so potentialScoreGain is null.
    if (leaf.hasEvidence && leaf.latestEvidenceAt && leaf.latestEvidenceAt < staleCutoff) {
      drafts.push({
        controlId: leaf.id,
        type: RecommendationType.STALE_EVIDENCE,
        title: `Evidence for "${label}" is over ${STALE_EVIDENCE_DAYS} days old`,
        description: `The most recent evidence for this control was collected on ${leaf.latestEvidenceAt.toISOString().slice(0, 10)}. Refresh it before the next audit cycle.`,
        potentialScoreGain: null,
      });
    }

    // MISSING_EVIDENCE — nothing at all: no evidence, no cross-walk mapping.
    if (!leaf.hasEvidence && !leaf.hasAnyMapping) {
      missingEvidenceCandidates.push({
        controlId: leaf.id,
        type: RecommendationType.MISSING_EVIDENCE,
        title: `No evidence for "${label}"`,
        description: `This control has no evidence and no cross-walk mapping to another framework. Add evidence to close the gap.`,
        potentialScoreGain: Math.round((85 / totalLeaves) * 10) / 10,
      });
    }

    // UNMAPPED_HIGH_VALUE_CONTROL — only a weak (PARTIAL/RELATED) link, never
    // EQUIVALENT or direct evidence, and its family is still underperforming.
    if (
      !leaf.hasEvidence &&
      leaf.hasAnyMapping &&
      leaf.bestStrengthRank !== null &&
      leaf.bestStrengthRank < 3 && // < EQUIVALENT
      famScore < UNMAPPED_HIGH_VALUE_FAMILY_THRESHOLD
    ) {
      const gain = Math.round(((85 - leaf.mappingCredit * 15) / totalLeaves) * 10) / 10;
      drafts.push({
        controlId: leaf.id,
        type: RecommendationType.UNMAPPED_HIGH_VALUE_CONTROL,
        title: `"${label}" only has a partial cross-walk match`,
        description: `This control relies on a PARTIAL or RELATED mapping instead of direct evidence, and its family (${familyLabels.get(famId) ?? famId}) is at ${famScore}% — below the ${UNMAPPED_HIGH_VALUE_FAMILY_THRESHOLD}% threshold. Add direct evidence or upgrade the mapping.`,
        potentialScoreGain: gain,
      });
    }
  }

  // Sort MISSING_EVIDENCE by impact and cap — per spec.
  missingEvidenceCandidates.sort((a, b) => (b.potentialScoreGain ?? 0) - (a.potentialScoreGain ?? 0));
  drafts.push(...missingEvidenceCandidates.slice(0, MISSING_EVIDENCE_CAP));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.recommendation.findMany({
      where: { organizationId, frameworkId },
      select: { controlId: true, type: true, status: true, potentialScoreGain: true },
    });
    const dismissed = new Map<string, number | null>();
    for (const r of existing) {
      if (r.status === RecommendationStatus.DISMISSED) {
        dismissed.set(`${r.controlId ?? "null"}:${r.type}`, r.potentialScoreGain);
      }
    }

    await tx.recommendation.deleteMany({ where: { organizationId, frameworkId, status: RecommendationStatus.OPEN } });

    const toCreate = drafts.filter((d) => {
      const key = `${d.controlId ?? "null"}:${d.type}`;
      if (!dismissed.has(key)) return true;
      const prevGain = dismissed.get(key) ?? 0;
      const newGain = d.potentialScoreGain ?? 0;
      return Math.abs(newGain - prevGain) > MATERIAL_GAIN_DELTA;
    });

    if (toCreate.length > 0) {
      await tx.recommendation.createMany({
        data: toCreate.map((d) => ({
          organizationId,
          frameworkId,
          controlId: d.controlId,
          type: d.type,
          title: d.title,
          description: d.description,
          potentialScoreGain: d.potentialScoreGain,
        })),
      });
    }
  });
}
