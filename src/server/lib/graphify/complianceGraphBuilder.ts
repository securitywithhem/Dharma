// Phase 9 Part 2 — compliance graph builder for AI board-summary narration.
//
// ┌─ DESIGN-GAP / DEVIATION (flagged in the Phase 9 Part 2 summary) ─────────┐
// │ The task brief calls for the external `graphify` CLI (`graphify ingest`) │
// │ to extract this graph. That binary IS installed on the dev box (v0.9.12) │
// │ but it is the agent's CODE-knowledge-graph tool: it ingests source files │
// │ / URLs / GitHub repos via Tree-sitter and writes a single shared         │
// │ graphify-out/graph.json (commands: path/explain/update/merge/cluster).   │
// │ It has no command to ingest a live app's per-tenant Prisma rows, is not  │
// │ org-scoped, and writing every org's compliance graph into one on-disk    │
// │ file would be a tenant-isolation hazard. Using a dev/CI code-analysis    │
// │ CLI as a runtime multi-tenant data pipeline is the wrong tool.           │
// │                                                                          │
// │ We therefore implement the graph EXTRACTION natively here — producing    │
// │ the exact compact { nodes, edges } digest shape a graph tool would, but  │
// │ org-scoped at QUERY time (never post-filtered), then feed that digest    │
// │ (not raw Prisma rows, never raw evidence file contents) to the LLM. This │
// │ honors the brief's real intent — structured graph digest → grounded      │
// │ narration, the token-efficiency + factual-grounding win over naive RAG — │
// │ without abusing the code CLI. Not silently stubbed: this is a real       │
// │ extractor with tests. See tests/complianceGraph.test.ts.                 │
// └──────────────────────────────────────────────────────────────────────────┘
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { redis } from "@/lib/redis";

export type GraphNodeType =
  | "Control"
  | "Evidence"
  | "Vulnerability"
  | "Endpoint"
  | "Framework";

export interface GraphDigestNode {
  id: string;
  type: GraphNodeType;
  /** Short human label — never raw evidence file contents (token blowup guard). */
  label: string;
  /** A few scalar attributes only (status, severity, score …). No blobs. */
  attrs?: Record<string, string | number | boolean | null>;
}

export interface GraphDigestEdge {
  from: string;
  to: string;
  /** "supports" | "affects" | "attests" | "crosswalks" | "contains" */
  relation: string;
}

export interface ComplianceGraphDigest {
  organizationId: string;
  generatedAt: string;
  dateRange: { from: string | null; to: string | null };
  counts: {
    frameworks: number;
    controls: number;
    evidence: number;
    vulnerabilities: number;
    endpoints: number;
  };
  nodes: GraphDigestNode[];
  edges: GraphDigestEdge[];
}

export interface ComplianceGraphConfig {
  frameworkIds?: string[];
  from?: Date | null;
  to?: Date | null;
  /** Hard cap on nodes fed to the LLM — bounds prompt size regardless of org size. */
  maxNodesPerType?: number;
}

const DEFAULT_MAX_NODES_PER_TYPE = 40;
const DIGEST_TTL_SECONDS = 60 * 60; // 1h, per brief

/** Stable hash of the config so identical report requests reuse the digest. */
export function graphDigestConfigHash(config: ComplianceGraphConfig): string {
  const normalized = JSON.stringify({
    frameworkIds: [...(config.frameworkIds ?? [])].sort(),
    from: config.from?.toISOString() ?? null,
    to: config.to?.toISOString() ?? null,
    maxNodesPerType: config.maxNodesPerType ?? DEFAULT_MAX_NODES_PER_TYPE,
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function digestCacheKey(organizationId: string, configHash: string): string {
  return `org:report:graphDigest:${organizationId}:${configHash}`;
}

/**
 * Builds the org-scoped compliance graph digest.
 *
 * Tenant isolation: EVERY query filters by organizationId (and Control access
 * goes through Framework.organizationId) in the WHERE clause — never fetched
 * broadly and filtered afterward. A date range, when given, bounds Evidence /
 * Vulnerability / EndpointCheck recency. Node counts are capped per type so
 * the resulting prompt stays small for any org size.
 */
export async function buildComplianceGraphDigest(
  prisma: PrismaClient,
  organizationId: string,
  config: ComplianceGraphConfig = {},
): Promise<ComplianceGraphDigest> {
  const cap = config.maxNodesPerType ?? DEFAULT_MAX_NODES_PER_TYPE;
  const dateFilter =
    config.from || config.to
      ? { gte: config.from ?? undefined, lte: config.to ?? undefined }
      : undefined;

  const frameworkWhere = {
    organizationId,
    ...(config.frameworkIds && config.frameworkIds.length > 0
      ? { id: { in: config.frameworkIds } }
      : {}),
  };

  // ── Frameworks + Controls (org-scoped via framework) ────────────────────
  const frameworks = await prisma.framework.findMany({
    where: frameworkWhere,
    select: { id: true, name: true },
  });
  const frameworkIds = frameworks.map((f) => f.id);

  const controls = await prisma.control.findMany({
    where: { framework: { ...frameworkWhere } },
    select: { id: true, title: true, domain: true, status: true, frameworkId: true },
    orderBy: { updatedAt: "desc" },
    take: cap,
  });
  const controlIdSet = new Set(controls.map((c) => c.id));

  // ── Evidence (supports → Control) ───────────────────────────────────────
  const evidence = await prisma.evidence.findMany({
    where: {
      organizationId,
      ...(frameworkIds.length > 0 ? { control: { frameworkId: { in: frameworkIds } } } : {}),
      ...(dateFilter ? { collectedAt: dateFilter } : {}),
    },
    select: { id: true, fileName: true, type: true, source: true, controlId: true },
    orderBy: { collectedAt: "desc" },
    take: cap,
  });

  // ── Vulnerabilities (affects → Control) ─────────────────────────────────
  const vulnerabilities = await prisma.vulnerability.findMany({
    where: {
      organizationId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    select: { id: true, title: true, severity: true, status: true, controlId: true },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: cap,
  });

  // ── Endpoints + their mapped checks (attests → Control) ─────────────────
  const endpoints = await prisma.endpoint.findMany({
    where: { organizationId },
    select: {
      id: true,
      hostname: true,
      status: true,
      checks: {
        where: {
          controlId: { not: null },
          ...(dateFilter ? { collectedAt: dateFilter } : {}),
        },
        select: { controlId: true, checkType: true, result: true },
        orderBy: { collectedAt: "desc" },
        take: 20,
      },
    },
    take: cap,
  });

  // ── Control ↔ Control crosswalks (org-scoped) ───────────────────────────
  const mappings = await prisma.controlMapping.findMany({
    where: {
      organizationId,
      sourceControlId: { in: [...controlIdSet] },
      targetControlId: { in: [...controlIdSet] },
    },
    select: { sourceControlId: true, targetControlId: true },
    take: cap * 2,
  });

  // ── Assemble the digest ─────────────────────────────────────────────────
  const nodes: GraphDigestNode[] = [];
  const edges: GraphDigestEdge[] = [];

  for (const f of frameworks) {
    nodes.push({ id: `fw:${f.id}`, type: "Framework", label: f.name });
  }
  for (const c of controls) {
    nodes.push({
      id: `ctl:${c.id}`,
      type: "Control",
      label: `${c.domain} — ${c.title}`.slice(0, 120),
      attrs: { status: c.status },
    });
    edges.push({ from: `fw:${c.frameworkId}`, to: `ctl:${c.id}`, relation: "contains" });
  }
  for (const e of evidence) {
    nodes.push({
      id: `ev:${e.id}`,
      type: "Evidence",
      // Label is the file NAME + type only — never file contents.
      label: `${e.type}: ${e.fileName}`.slice(0, 100),
      attrs: { source: e.source },
    });
    if (e.controlId && controlIdSet.has(e.controlId)) {
      edges.push({ from: `ev:${e.id}`, to: `ctl:${e.controlId}`, relation: "supports" });
    }
  }
  for (const v of vulnerabilities) {
    nodes.push({
      id: `vln:${v.id}`,
      type: "Vulnerability",
      label: v.title.slice(0, 100),
      attrs: { severity: v.severity, status: v.status },
    });
    if (v.controlId && controlIdSet.has(v.controlId)) {
      edges.push({ from: `vln:${v.id}`, to: `ctl:${v.controlId}`, relation: "affects" });
    }
  }
  for (const ep of endpoints) {
    nodes.push({
      id: `ep:${ep.id}`,
      type: "Endpoint",
      label: ep.hostname,
      attrs: { status: ep.status },
    });
    const seen = new Set<string>();
    for (const chk of ep.checks) {
      if (!chk.controlId || !controlIdSet.has(chk.controlId)) continue;
      const key = `${ep.id}->${chk.controlId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pass = (chk.result as { pass?: boolean } | null)?.pass;
      edges.push({
        from: `ep:${ep.id}`,
        to: `ctl:${chk.controlId}`,
        relation: pass === false ? "attests-fail" : "attests",
      });
    }
  }
  for (const m of mappings) {
    edges.push({
      from: `ctl:${m.sourceControlId}`,
      to: `ctl:${m.targetControlId}`,
      relation: "crosswalks",
    });
  }

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    dateRange: {
      from: config.from?.toISOString() ?? null,
      to: config.to?.toISOString() ?? null,
    },
    counts: {
      frameworks: frameworks.length,
      controls: controls.length,
      evidence: evidence.length,
      vulnerabilities: vulnerabilities.length,
      endpoints: endpoints.length,
    },
    nodes,
    edges,
  };
}

/**
 * Cached wrapper: reuses a digest for the same org+config within the TTL
 * (1h) so regenerating a report doesn't re-run extraction. The cache key
 * embeds organizationId, so one org can never read another's cached digest.
 */
export async function getOrBuildComplianceGraphDigest(
  prisma: PrismaClient,
  organizationId: string,
  config: ComplianceGraphConfig = {},
): Promise<ComplianceGraphDigest> {
  const key = digestCacheKey(organizationId, graphDigestConfigHash(config));

  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as ComplianceGraphDigest;
      // Defense-in-depth: never return a digest whose org doesn't match.
      if (parsed.organizationId === organizationId) return parsed;
    }
  } catch {
    // Cache read failure is non-fatal — fall through to a fresh build.
  }

  const digest = await buildComplianceGraphDigest(prisma, organizationId, config);

  try {
    await redis.set(key, JSON.stringify(digest), "EX", DIGEST_TTL_SECONDS);
  } catch {
    // Cache write failure is non-fatal.
  }

  return digest;
}

/**
 * Renders the digest as a compact, LLM-friendly fact list. Deterministic and
 * bounded — this string (not raw rows, never evidence contents) is what the
 * board-summary prompt consumes.
 */
export function digestToPromptFacts(digest: ComplianceGraphDigest): string {
  const lines: string[] = [];
  lines.push(
    `Organization compliance graph (${digest.counts.frameworks} frameworks, ` +
      `${digest.counts.controls} controls, ${digest.counts.evidence} evidence items, ` +
      `${digest.counts.vulnerabilities} vulnerabilities, ${digest.counts.endpoints} endpoints).`,
  );

  const byType = (t: GraphNodeType) => digest.nodes.filter((n) => n.type === t);

  const controlStatus = new Map<string, number>();
  for (const c of byType("Control")) {
    const s = String(c.attrs?.status ?? "UNKNOWN");
    controlStatus.set(s, (controlStatus.get(s) ?? 0) + 1);
  }
  if (controlStatus.size > 0) {
    lines.push(
      "Control status: " +
        [...controlStatus.entries()].map(([s, n]) => `${n} ${s}`).join(", ") + ".",
    );
  }

  const vulns = byType("Vulnerability");
  if (vulns.length > 0) {
    const bySev = new Map<string, number>();
    for (const v of vulns) {
      const s = String(v.attrs?.severity ?? "UNKNOWN");
      bySev.set(s, (bySev.get(s) ?? 0) + 1);
    }
    lines.push(
      "Open/recent vulnerabilities by severity: " +
        [...bySev.entries()].map(([s, n]) => `${n} ${s}`).join(", ") + ".",
    );
  }

  const failingAttests = digest.edges.filter((e) => e.relation === "attests-fail").length;
  const passingAttests = digest.edges.filter((e) => e.relation === "attests").length;
  if (passingAttests + failingAttests > 0) {
    lines.push(
      `Endpoint attestations: ${passingAttests} passing, ${failingAttests} failing checks mapped to controls.`,
    );
  }

  const supported = new Set(
    digest.edges.filter((e) => e.relation === "supports").map((e) => e.to),
  ).size;
  lines.push(`${supported} controls have supporting evidence.`);

  const crosswalks = digest.edges.filter((e) => e.relation === "crosswalks").length;
  if (crosswalks > 0) lines.push(`${crosswalks} cross-framework control mappings exist.`);

  return lines.join("\n");
}
