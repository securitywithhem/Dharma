/**
 * src/server/ai/retrieval.ts
 *
 * Phase 7 Part 2 — hybrid retrieval for the AI Advisor RAG pipeline.
 *
 * Combines three org-scoped sources into one context object:
 *   1. Vector search  — pgvector cosine similarity over OrganizationEmbedding.
 *   2. Graph relations — 1-hop edges from the OrgGraphNode/OrgGraphEdge graph
 *      built in Part 1, keyed off each chunk's metadata.graphNodeId.
 *   3. Live controls   — real-time Control status + ControlMapping rows from
 *      the Phase 6 tables, so answers reflect current compliance state, not
 *      just stale embedded text (honours the "AI advisor depends on Phase 6"
 *      dependency in 6_IMPLEMENTATION_PLAN.md).
 *
 * TENANT ISOLATION (hard requirement): every query is scoped to
 * `organizationId = orgId`. The raw pgvector query is fully PARAMETERIZED via
 * Prisma's `$queryRaw` tagged template — `orgId`, the query vector, and the
 * limit are bound parameters, never string-concatenated. Removing the
 * `WHERE "organizationId" = ${orgId}` clause is what tests/retrieval.test.ts's
 * regression case guards against.
 */

import { Prisma, type PrismaClient, type ControlStatus } from "@prisma/client";
import { embedText } from "@/server/ai/embeddingClient";

/** Default number of chunks pulled from the vector store. */
export const DEFAULT_TOP_K = 8;

export interface ScoredChunk {
  id: string;
  content: string;
  chunkIndex: number;
  documentType: string;
  documentId: string;
  sourceDocumentId: string | null;
  graphNodeId: string | null;
  /** Cosine distance in [0, 2]; lower is more similar. */
  distance: number;
}

export interface GraphRelation {
  fromNodeId: string;
  fromLabel: string;
  relation: string;
  toNodeId: string;
  toLabel: string;
}

export interface ControlSummary {
  controlId: string;
  code: string | null;
  title: string;
  status: ControlStatus;
  domain: string;
  frameworkId: string;
  frameworkName: string;
  /** Codes/titles this control is cross-walked to (Phase 6 ControlMapping). */
  mappedTo: string[];
}

export interface RetrievedContext {
  query: string;
  chunks: ScoredChunk[];
  graphRelations: GraphRelation[];
  liveControls: ControlSummary[];
  /**
   * Phase 7 Part 3 (additive) — human-readable names of the sources that fed
   * this context, for the chat UI's ContextBar. Optional so existing callers /
   * test fixtures that build RetrievedContext literals need not set it.
   */
  sources?: { documents: string[]; frameworks: string[] };
}

export interface RetrieveOptions {
  topK?: number;
  /** Injectable embedder (tests supply a deterministic vector; prod uses Ollama). */
  embedQuery?: (query: string) => Promise<number[]>;
}

type ChunkRow = {
  id: string;
  content: string;
  chunkIndex: number;
  documentType: string;
  documentId: string;
  sourceDocumentId: string | null;
  metadata: unknown;
  distance: number;
};

/** Pull a graph node id from an embedding row's metadata, if present. */
function graphNodeIdOf(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (typeof m.graphNodeId === "string") return m.graphNodeId;
    if (Array.isArray(m.graphNodeIds) && typeof m.graphNodeIds[0] === "string") return m.graphNodeIds[0] as string;
  }
  return null;
}

/**
 * Retrieve org-scoped context for a query. `orgId` is enforced on every
 * source. Returns raw scored chunks (distance included) — similarity
 * thresholding / fallback decisions are made by the caller using the
 * SIMILARITY_DISTANCE_THRESHOLD constant in promptTemplates.ts.
 */
export async function retrieveContext(
  prisma: PrismaClient,
  orgId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedContext> {
  const topK = Math.max(1, Math.min(opts.topK ?? DEFAULT_TOP_K, 50));

  // 1. Embed the query (per-org provider by default; injectable for tests).
  const embed = opts.embedQuery ?? ((q: string) => embedText(q, { organizationId: orgId, prisma }));
  const vector = await embed(query);
  const vectorLiteral = `[${vector.join(",")}]`;

  // 2. Vector search — PARAMETERIZED, org-scoped. Do not de-parameterize.
  const chunkRows = await prisma.$queryRaw<ChunkRow[]>(Prisma.sql`
    SELECT id,
           content,
           "chunkIndex" AS "chunkIndex",
           "documentType" AS "documentType",
           "documentId" AS "documentId",
           "sourceDocumentId" AS "sourceDocumentId",
           metadata,
           (embedding <=> ${vectorLiteral}::vector) AS distance
    FROM "OrganizationEmbedding"
    WHERE "organizationId" = ${orgId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `);

  const chunks: ScoredChunk[] = chunkRows.map((r) => ({
    id: r.id,
    content: r.content,
    chunkIndex: r.chunkIndex,
    documentType: r.documentType,
    documentId: r.documentId,
    sourceDocumentId: r.sourceDocumentId,
    graphNodeId: graphNodeIdOf(r.metadata),
    distance: Number(r.distance),
  }));

  // 3. Graph relations — 1-hop edges touching any retrieved chunk's node, org-scoped.
  const nodeIds = Array.from(new Set(chunks.map((c) => c.graphNodeId).filter((x): x is string => !!x)));
  let graphRelations: GraphRelation[] = [];
  if (nodeIds.length > 0) {
    const edges = await prisma.orgGraphEdge.findMany({
      where: {
        organizationId: orgId,
        OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
      },
      select: {
        fromNodeId: true,
        toNodeId: true,
        relation: true,
        fromNode: { select: { label: true } },
        toNode: { select: { label: true } },
      },
      take: 50,
    });
    graphRelations = edges.map((e) => ({
      fromNodeId: e.fromNodeId,
      fromLabel: e.fromNode.label,
      relation: e.relation,
      toNodeId: e.toNodeId,
      toLabel: e.toNode.label,
    }));
  }

  // 4. Live controls — if the query names a framework, pull its current
  //    control statuses + cross-walk mappings from the Phase 6 tables.
  const liveControls = await retrieveLiveControls(prisma, orgId, query);

  // 5. Source names for the UI ContextBar (additive). Org-scoped.
  const docIds = Array.from(new Set(chunks.map((c) => c.sourceDocumentId).filter((x): x is string => !!x)));
  let documents: string[] = [];
  if (docIds.length > 0) {
    const docs = await prisma.ingestedDocument.findMany({
      where: { id: { in: docIds }, organizationId: orgId },
      select: { filename: true },
    });
    documents = docs.map((d) => d.filename);
  }
  const frameworks = Array.from(new Set(liveControls.map((c) => c.frameworkName).filter(Boolean)));

  return { query, chunks, graphRelations, liveControls, sources: { documents, frameworks } };
}

/**
 * Structured, real-time control state for any org framework whose name appears
 * in the query. Org-scoped via Framework.organizationId (Control has no direct
 * organizationId column). Bounded to keep the prompt small.
 */
async function retrieveLiveControls(prisma: PrismaClient, orgId: string, query: string): Promise<ControlSummary[]> {
  const q = query.toLowerCase();
  const frameworks = await prisma.framework.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
  });
  const matched = frameworks.filter((f) => f.name && q.includes(f.name.toLowerCase()));
  if (matched.length === 0) return [];

  const frameworkNameById = new Map(matched.map((f) => [f.id, f.name]));
  const controls = await prisma.control.findMany({
    where: { frameworkId: { in: matched.map((f) => f.id) } },
    select: { id: true, code: true, title: true, status: true, domain: true, frameworkId: true },
    take: 50,
    orderBy: [{ frameworkId: "asc" }, { sortOrder: "asc" }],
  });
  if (controls.length === 0) return [];

  // Phase 6 ControlMapping — cross-walk targets for the retrieved controls.
  const controlIds = controls.map((c) => c.id);
  const mappings = await prisma.controlMapping.findMany({
    // ACCEPTED only: this feeds the Compliance Advisor's answer context, so an
    // unreviewed machine proposal here would have the assistant tell a user a
    // control is cross-walked when no human has ever agreed that it is.
    where: { organizationId: orgId, sourceControlId: { in: controlIds }, status: "ACCEPTED" },
    select: {
      sourceControlId: true,
      targetControl: { select: { code: true, title: true } },
    },
    take: 200,
  });
  const mappedBySource = new Map<string, string[]>();
  for (const m of mappings) {
    const label = m.targetControl.code ?? m.targetControl.title;
    const arr = mappedBySource.get(m.sourceControlId) ?? [];
    arr.push(label);
    mappedBySource.set(m.sourceControlId, arr);
  }

  return controls.map((c) => ({
    controlId: c.id,
    code: c.code,
    title: c.title,
    status: c.status,
    domain: c.domain,
    frameworkId: c.frameworkId,
    frameworkName: frameworkNameById.get(c.frameworkId) ?? "",
    mappedTo: mappedBySource.get(c.id) ?? [],
  }));
}
