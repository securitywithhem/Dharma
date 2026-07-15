// Phase 9 Part 2 — report section data aggregation + board-summary narration.
//
// The CUSTOM_PDF path pulls only the SELECTED sections' data (org-scoped),
// reusing Phase 6's computeReadinessScore for the readiness section rather
// than reimplementing scoring. The BOARD_SUMMARY path builds the compliance
// graph digest and narrates it via the Phase 7 LLM client — the LLM sees the
// compact digest fact-list ONLY, never raw evidence contents.
import type { PrismaClient } from "@prisma/client";
import { computeReadinessScore } from "@/server/services/readinessScoring";
import { streamCompletion } from "@/server/ai/completionClient";
import {
  getOrBuildComplianceGraphDigest,
  digestToPromptFacts,
  type ComplianceGraphConfig,
  type ComplianceGraphDigest,
} from "@/server/lib/graphify/complianceGraphBuilder";

export type ReportSection =
  | "framework_readiness"
  | "evidence_status"
  | "vulnerability_trend"
  | "endpoint_compliance";

export const REPORT_SECTIONS: ReportSection[] = [
  "framework_readiness",
  "evidence_status",
  "vulnerability_trend",
  "endpoint_compliance",
];

export interface CustomReportConfig {
  sections: ReportSection[];
  frameworkIds?: string[];
  from?: string | null; // ISO
  to?: string | null; // ISO
}

export interface FrameworkReadinessRow {
  frameworkId: string;
  frameworkName: string;
  overallScore: number;
  evidenceScore: number;
  mappingBonus: number;
}

export interface CustomReportData {
  organizationName: string;
  generatedAt: string;
  dateRange: { from: string | null; to: string | null };
  sections: {
    frameworkReadiness?: FrameworkReadinessRow[];
    evidenceStatus?: { total: number; byType: Record<string, number>; bySource: Record<string, number> };
    vulnerabilityTrend?: { total: number; bySeverity: Record<string, number>; byStatus: Record<string, number> };
    endpointCompliance?: {
      total: number;
      byStatus: Record<string, number>;
      passingChecks: number;
      failingChecks: number;
    };
  };
}

function toDate(iso: string | null | undefined): Date | undefined {
  return iso ? new Date(iso) : undefined;
}

/** Aggregates ONLY the requested sections, all org-scoped. */
export async function buildCustomReportData(
  prisma: PrismaClient,
  organizationId: string,
  config: CustomReportConfig,
): Promise<CustomReportData> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });
  const from = toDate(config.from);
  const to = toDate(config.to);
  const dateFilter = from || to ? { gte: from, lte: to } : undefined;
  const wanted = new Set(config.sections);
  const sections: CustomReportData["sections"] = {};

  if (wanted.has("framework_readiness")) {
    const frameworks = await prisma.framework.findMany({
      where: {
        organizationId,
        ...(config.frameworkIds && config.frameworkIds.length > 0
          ? { id: { in: config.frameworkIds } }
          : {}),
      },
      select: { id: true, name: true },
    });
    const rows: FrameworkReadinessRow[] = [];
    for (const fw of frameworks) {
      // frameworkId is already confirmed org-owned by the query above.
      const score = await computeReadinessScore(prisma, organizationId, fw.id);
      rows.push({
        frameworkId: fw.id,
        frameworkName: fw.name,
        overallScore: score.overallScore,
        evidenceScore: score.evidenceScore,
        mappingBonus: score.mappingBonus,
      });
    }
    sections.frameworkReadiness = rows;
  }

  if (wanted.has("evidence_status")) {
    const evidence = await prisma.evidence.findMany({
      where: { organizationId, ...(dateFilter ? { collectedAt: dateFilter } : {}) },
      select: { type: true, source: true },
    });
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const e of evidence) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    sections.evidenceStatus = { total: evidence.length, byType, bySource };
  }

  if (wanted.has("vulnerability_trend")) {
    const vulns = await prisma.vulnerability.findMany({
      where: { organizationId, ...(dateFilter ? { createdAt: dateFilter } : {}) },
      select: { severity: true, status: true },
    });
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const v of vulns) {
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
      byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
    }
    sections.vulnerabilityTrend = { total: vulns.length, bySeverity, byStatus };
  }

  if (wanted.has("endpoint_compliance")) {
    const endpoints = await prisma.endpoint.findMany({
      where: { organizationId },
      select: { status: true },
    });
    const byStatus: Record<string, number> = {};
    for (const ep of endpoints) byStatus[ep.status] = (byStatus[ep.status] ?? 0) + 1;

    const checks = await prisma.endpointCheck.findMany({
      where: { organizationId, ...(dateFilter ? { collectedAt: dateFilter } : {}) },
      select: { result: true },
    });
    let passingChecks = 0;
    let failingChecks = 0;
    for (const c of checks) {
      const pass = (c.result as { pass?: boolean } | null)?.pass;
      if (pass === true) passingChecks += 1;
      else if (pass === false) failingChecks += 1;
    }
    sections.endpointCompliance = {
      total: endpoints.length,
      byStatus,
      passingChecks,
      failingChecks,
    };
  }

  return {
    organizationName: org.name,
    generatedAt: new Date().toISOString(),
    dateRange: { from: config.from ?? null, to: config.to ?? null },
    sections,
  };
}

const BOARD_SUMMARY_SYSTEM_PROMPT =
  "You are summarizing compliance posture for a board audience. Use ONLY the " +
  "provided graph facts. Do not speculate or invent numbers. Write 300-500 " +
  "words in an executive tone: current posture, key risks (weighted by " +
  "vulnerability severity and failing endpoint attestations), evidence " +
  "coverage, and 2-3 prioritized recommendations grounded strictly in the " +
  "facts. No markdown headers; short paragraphs.";

export interface BoardSummaryResult {
  narrative: string;
  digest: ComplianceGraphDigest;
  overallReadiness: number | null;
  usage: { promptTokens: number; completionTokens: number };
}

/**
 * Narration seam. Defaults to the Phase 7 streaming LLM client; tests inject
 * a deterministic stub so the board-summary path runs offline (same
 * dependency-injection spirit as passing `prisma` into workers).
 */
export type Narrator = (
  systemPrompt: string,
  userContent: string,
) => Promise<{ fullText: string; usage: { promptTokens: number; completionTokens: number } }>;

const defaultNarrator: Narrator = async (systemPrompt, userContent) => {
  const result = await streamCompletion({
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    maxRetries: 2,
  });
  return { fullText: result.fullText, usage: result.usage };
};

/**
 * Board summary: extract the org compliance graph digest, narrate it via the
 * LLM. The prompt receives the compact fact-list from digestToPromptFacts —
 * never raw Prisma rows and never evidence file contents (token-blowup +
 * grounding guard called out in the brief's Step 6).
 */
export async function buildBoardSummary(
  prisma: PrismaClient,
  organizationId: string,
  graphConfig: ComplianceGraphConfig = {},
  narrate: Narrator = defaultNarrator,
): Promise<BoardSummaryResult> {
  const digest = await getOrBuildComplianceGraphDigest(prisma, organizationId, graphConfig);
  const facts = digestToPromptFacts(digest);

  // Overall readiness across the (optionally filtered) frameworks, for the
  // small chart rendered next to the narrative.
  const frameworks = await prisma.framework.findMany({
    where: {
      organizationId,
      ...(graphConfig.frameworkIds && graphConfig.frameworkIds.length > 0
        ? { id: { in: graphConfig.frameworkIds } }
        : {}),
    },
    select: { id: true },
  });
  let overallReadiness: number | null = null;
  if (frameworks.length > 0) {
    let sum = 0;
    for (const fw of frameworks) {
      const s = await computeReadinessScore(prisma, organizationId, fw.id);
      sum += s.overallScore;
    }
    overallReadiness = Math.round((sum / frameworks.length) * 10) / 10;
  }

  const userContent =
    `Graph facts for the reporting period:\n${facts}\n\n` +
    (overallReadiness !== null
      ? `Average framework readiness score: ${overallReadiness}/100.\n\n`
      : "") +
    "Write the board summary now.";

  const result = await narrate(BOARD_SUMMARY_SYSTEM_PROMPT, userContent);

  return {
    narrative: result.fullText.trim(),
    digest,
    overallReadiness,
    usage: result.usage,
  };
}
