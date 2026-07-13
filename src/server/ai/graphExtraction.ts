/**
 * src/server/ai/graphExtraction.ts
 *
 * Phase 7 Part 1 — per-organization knowledge-graph extraction.
 *
 * DESIGN NOTE — why this isn't a direct call into Graphify:
 * Graphify (`~/.claude/skills/graphify`) is a CLI / MCP tool that builds a
 * graph from a *folder of files* into a shared `graphify-out/` store. It has no
 * in-process Node SDK and no per-tenant namespace parameter, so it cannot be
 * invoked safely per-org from a BullMQ worker at runtime. The hard requirement
 * from the ingestion spec is TENANT ISOLATION: every graph node/edge must be
 * scoped to one organization and cross-org queries must return zero rows.
 *
 * We satisfy that by persisting the extracted graph into Postgres tables
 * (`OrgGraphNode` / `OrgGraphEdge`), every row stamped with `organizationId`
 * and `sourceDocumentId`. This is the pluggable seam: `extractGraph` is where a
 * Graphify CLI/graph-DB backend can later be dropped in, but persistence and
 * all queries stay org-scoped in our own DB so isolation is enforced by the
 * schema, not by a third party.
 *
 * Extraction itself uses the org's resolved InferenceProvider (LLM) when
 * available, with a deterministic heuristic fallback so the pipeline still
 * produces a graph with no LLM reachable (and so it is unit-testable).
 */

import type { PrismaClient } from "@prisma/client";
import type { InferenceProvider } from "@/lib/ai/InferenceProvider";

export interface ExtractedNode {
  label: string;
  /** "control" | "policy" | "requirement" | "system" | "entity" */
  nodeType: string;
}

export interface ExtractedEdge {
  from: string; // node label
  to: string; // node label
  relation: string; // "implements" | "requires" | "mitigates" | "related"
}

export interface ExtractedGraph {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
}

export interface GraphPersistResult {
  nodeCount: number;
  edgeCount: number;
  /** label (lower-cased) → persisted OrgGraphNode.id, for chunk cross-referencing. */
  nodeIdByLabel: Map<string, string>;
}

const nodeKey = (nodeType: string, label: string) => `${nodeType}::${label.trim().toLowerCase()}`;

// ---------------------------------------------------------------------------
// Deterministic heuristic extractor (fallback / test path)
// ---------------------------------------------------------------------------

// Control identifiers like "CC6.1", "A.9.2.1", "AC-2", "PR.AC-1".
const CONTROL_CODE_RE = /\b([A-Z]{1,4}[.-]?\d+(?:[.-]\d+){0,3})\b/g;
// Named policies like "Access Control Policy", "Incident Response Policy".
const POLICY_RE = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4}\s+Policy)\b/g;

/**
 * Heuristic entity/relationship extraction — no LLM required. Finds control
 * codes and named policies, and links a policy to any control mentioned in the
 * same sentence with an `implements` edge. Deterministic and side-effect free.
 */
export function heuristicExtract(text: string): ExtractedGraph {
  const nodeSet = new Map<string, ExtractedNode>();
  const edges: ExtractedEdge[] = [];
  const seenEdge = new Set<string>();

  const addNode = (label: string, nodeType: string) => {
    const clean = label.trim();
    if (!clean) return;
    nodeSet.set(nodeKey(nodeType, clean), { label: clean, nodeType });
  };

  // Sentence-level scan so relationships stay local to a statement.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const controls = Array.from(sentence.matchAll(CONTROL_CODE_RE), (m) => m[1]);
    const policies = Array.from(sentence.matchAll(POLICY_RE), (m) => m[1]);

    for (const c of controls) addNode(c, "control");
    for (const p of policies) addNode(p, "policy");

    // policy —implements→ control (co-occurrence within a sentence)
    for (const p of policies) {
      for (const c of controls) {
        const relation = /require|must|enforce/i.test(sentence) ? "requires" : "implements";
        const key = `${p.toLowerCase()}|${relation}|${c.toLowerCase()}`;
        if (!seenEdge.has(key)) {
          seenEdge.add(key);
          edges.push({ from: p, to: c, relation });
        }
      }
    }
  }

  return { nodes: Array.from(nodeSet.values()), edges };
}

// ---------------------------------------------------------------------------
// LLM extractor (production path)
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are a compliance knowledge-graph extractor.
Read the document and extract entities and their relationships.
Return ONLY a JSON object with this exact shape, no prose:
{
  "nodes": [{ "label": "<entity name>", "nodeType": "control|policy|requirement|system|entity" }],
  "edges": [{ "from": "<node label>", "to": "<node label>", "relation": "implements|requires|mitigates|related" }]
}
Entities are things like control identifiers (e.g. "CC6.1"), named policies, systems, and requirements.
Only include edges whose 'from' and 'to' both appear in 'nodes'. Keep labels short and canonical.`;

/** Extract a graph via the org's LLM provider. Throws if the model output is unusable. */
async function llmExtract(text: string, provider: InferenceProvider): Promise<ExtractedGraph> {
  // Cap payload — extraction quality plateaus and local models have context limits.
  const payload = text.slice(0, 12_000);
  const result = await provider.chatJSON<ExtractedGraph>(EXTRACTION_SYSTEM_PROMPT, payload);
  if (!result || !Array.isArray(result.nodes)) {
    throw new Error("LLM returned no usable nodes array");
  }
  return {
    nodes: result.nodes.filter((n) => n && typeof n.label === "string" && n.label.trim()),
    edges: Array.isArray(result.edges) ? result.edges.filter((e) => e && e.from && e.to && e.relation) : [],
  };
}

/**
 * Extract a graph from document text. Prefers the LLM provider; on any failure
 * (unreachable Ollama, unparseable output) falls back to the deterministic
 * heuristic so ingestion always produces a graph.
 */
export async function extractGraph(text: string, provider?: InferenceProvider): Promise<ExtractedGraph> {
  if (provider) {
    try {
      const g = await llmExtract(text, provider);
      // If the model found nothing, still try the heuristic — better than empty.
      if (g.nodes.length > 0) return g;
    } catch (err) {
      console.warn(`[graph-extract] LLM extraction failed, using heuristic fallback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return heuristicExtract(text);
}

// ---------------------------------------------------------------------------
// Persistence (org-scoped) + lifecycle
// ---------------------------------------------------------------------------

/**
 * Extract and persist a document's graph, hard-scoped to `organizationId`.
 * Every node/edge row carries both `organizationId` and `sourceDocumentId`.
 * Returns counts and a label→nodeId map for chunk cross-referencing.
 */
export async function extractAndPersistGraph(
  prisma: PrismaClient,
  params: { organizationId: string; sourceDocumentId: string; text: string; provider?: InferenceProvider },
): Promise<GraphPersistResult> {
  const { organizationId, sourceDocumentId, text, provider } = params;
  const graph = await extractGraph(text, provider);

  const nodeIdByLabel = new Map<string, string>();
  const nodeIdByKey = new Map<string, string>();

  for (const node of graph.nodes) {
    const key = nodeKey(node.nodeType, node.label);
    if (nodeIdByKey.has(key)) continue;
    const created = await prisma.orgGraphNode.create({
      data: {
        organizationId,
        sourceDocumentId,
        nodeType: node.nodeType,
        label: node.label,
        metadata: { extractor: provider ? "llm-or-heuristic" : "heuristic" },
      },
      select: { id: true },
    });
    nodeIdByKey.set(key, created.id);
    nodeIdByLabel.set(node.label.trim().toLowerCase(), created.id);
  }

  let edgeCount = 0;
  for (const edge of graph.edges) {
    // Resolve endpoints; edges only persist when both nodes exist.
    const fromId =
      nodeIdByKey.get(nodeKey("policy", edge.from)) ??
      nodeIdByKey.get(nodeKey("control", edge.from)) ??
      findNodeIdByLabel(nodeIdByLabel, edge.from);
    const toId =
      nodeIdByKey.get(nodeKey("control", edge.to)) ??
      nodeIdByKey.get(nodeKey("policy", edge.to)) ??
      findNodeIdByLabel(nodeIdByLabel, edge.to);
    if (!fromId || !toId || fromId === toId) continue;
    await prisma.orgGraphEdge.create({
      data: { organizationId, sourceDocumentId, fromNodeId: fromId, toNodeId: toId, relation: edge.relation },
    });
    edgeCount++;
  }

  return { nodeCount: nodeIdByKey.size, edgeCount, nodeIdByLabel };
}

function findNodeIdByLabel(map: Map<string, string>, label: string): string | undefined {
  return map.get(label.trim().toLowerCase());
}

/**
 * Delete every graph node/edge for a document, scoped by BOTH organizationId
 * AND sourceDocumentId. Edges are removed first to respect FKs. Used when a
 * document is deleted or re-ingested, so no orphaned graph nodes survive
 * (a data-retention requirement). Returns counts removed.
 */
export async function pruneGraphForDocument(
  prisma: PrismaClient,
  organizationId: string,
  sourceDocumentId: string,
): Promise<{ nodes: number; edges: number }> {
  const edges = await prisma.orgGraphEdge.deleteMany({ where: { organizationId, sourceDocumentId } });
  const nodes = await prisma.orgGraphNode.deleteMany({ where: { organizationId, sourceDocumentId } });
  return { nodes: nodes.count, edges: edges.count };
}

/**
 * Query graph nodes for an org — strictly org-scoped. Exists so tenant
 * isolation can be asserted in tests and used by Part 2's retrieval layer.
 */
export async function queryGraphNodesForOrg(
  prisma: PrismaClient,
  organizationId: string,
  opts?: { nodeType?: string; labelContains?: string },
) {
  return prisma.orgGraphNode.findMany({
    where: {
      organizationId,
      ...(opts?.nodeType ? { nodeType: opts.nodeType } : {}),
      ...(opts?.labelContains ? { label: { contains: opts.labelContains, mode: "insensitive" } } : {}),
    },
    select: { id: true, label: true, nodeType: true, sourceDocumentId: true },
  });
}
