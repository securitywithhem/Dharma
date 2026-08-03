/**
 * src/server/services/controlEmbeddings.ts
 *
 * Phase 6 Part 2 — narrow, control-scoped embedding pipeline that powers
 * AI-suggested cross-walk mappings. This is a scoped precursor to Phase 7's
 * full document RAG, not Phase 7 itself: it only ever embeds a single
 * control's title+description text for control-to-control similarity.
 *
 * Mirrors src/server/pentest/vulnerabilityEmbedding.ts's pattern exactly:
 * Ollama's nomic-embed-text via getEmbedding(), written with raw SQL since
 * Prisma has no native vector read/write support. Reuses the existing
 * Control.embedding column (384-dim) rather than a separate embedding table —
 * see the comment on Control.embedding in schema.prisma.
 */

import type { PrismaClient } from "@prisma/client";
import { getEmbedding } from "@/workers/ollama";
import { assertEmbeddingDimension, getEmbeddingModel } from "@/server/ai/embeddingModels";

const OLLAMA_MODEL_EMBEDDING = getEmbeddingModel();

/** Builds the text embedded for a control — kept in one place so search relevance stays consistent. */
export function controlEmbeddingText(c: { title: string; description: string; code?: string | null }): string {
  return [c.code, c.title, c.description].filter(Boolean).join("\n\n");
}

/**
 * Generates and persists a title+description embedding for a Control.
 * Best-effort: never throws — a failed embedding must never block control
 * create/update, and only degrades AI suggestions (which fail open to "no
 * suggestions" when embeddings are missing). Tracks status/attempts on the
 * Control row itself for observability, matching Evidence's embeddingStatus
 * convention.
 */
export async function embedControl(prisma: PrismaClient, controlId: string): Promise<void> {
  const control = await prisma.control.findUnique({
    where: { id: controlId },
    select: { id: true, title: true, description: true, code: true, embeddingAttempts: true },
  });
  if (!control) return;

  const text = controlEmbeddingText(control);
  if (!text.trim()) {
    await prisma.control.update({
      where: { id: controlId },
      data: { embeddingStatus: "FAILED", embeddingError: "No text to embed." },
    });
    return;
  }

  try {
    const embedding = assertEmbeddingDimension(
      await getEmbedding(text, OLLAMA_MODEL_EMBEDDING),
      OLLAMA_MODEL_EMBEDDING,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "Control" SET embedding = $1::vector, "embeddingStatus" = 'SUCCESS', "embeddingError" = NULL, "embeddingAttempts" = "embeddingAttempts" + 1, "lastEmbeddingAttempt" = now() WHERE id = $2`,
      `[${embedding.join(",")}]`,
      controlId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[control-embedding] Failed to embed control ${controlId} — leaving embedding unset:`, message);
    await prisma.control.update({
      where: { id: controlId },
      data: {
        embeddingStatus: "FAILED",
        embeddingError: message.slice(0, 2000),
        embeddingAttempts: { increment: 1 },
        lastEmbeddingAttempt: new Date(),
      },
    });
  }
}

export interface MappingSuggestion {
  controlId: string;
  code: string | null;
  title: string;
  domain: string;
  /** Cosine similarity in [0, 1] — 1 is identical, derived as 1 - cosine_distance. */
  confidenceScore: number;
}

/**
 * Suggests cross-walk mapping candidates for `controlId` from among the
 * controls of `targetFrameworkId`, ranked by embedding cosine similarity.
 * Read-only — never writes a ControlMapping row. The caller (getSuggestions
 * / the UI's "Accept suggestion" flow) is responsible for calling
 * controlMapping.create with suggestedByAI/confidenceScore only after
 * explicit human confirmation.
 *
 * `topK` bounds the query with an explicit LIMIT — required since this runs
 * an ORDER BY over a cosine-distance operator across every embedded control
 * in the target framework.
 */
export async function suggestMappings(
  prisma: PrismaClient,
  organizationId: string,
  controlId: string,
  targetFrameworkId: string,
  topK = 5,
): Promise<MappingSuggestion[]> {
  const boundedTopK = Math.max(1, Math.min(topK, 25));

  const source = await prisma.control.findFirst({
    where: { id: controlId, framework: { organizationId } },
    select: { id: true },
  });
  if (!source) return [];

  // Confirm the target framework belongs to the same org before querying its
  // controls — org-scoping happens at this boundary, not inside the raw SQL.
  const targetFramework = await prisma.framework.findFirst({
    where: { id: targetFrameworkId, organizationId },
    select: { id: true },
  });
  if (!targetFramework) return [];

  const rows = await prisma.$queryRawUnsafe<
    { id: string; code: string | null; title: string; domain: string; score: number }[]
  >(
    `SELECT c.id, c.code, c.title, c.domain, 1 - (c.embedding <=> src.embedding) AS score
     FROM "Control" c, (SELECT embedding FROM "Control" WHERE id = $1) src
     WHERE c."frameworkId" = $2
       AND c.id != $1
       AND c.embedding IS NOT NULL
       AND src.embedding IS NOT NULL
     ORDER BY c.embedding <=> src.embedding
     LIMIT $3`,
    controlId,
    targetFrameworkId,
    boundedTopK,
  );

  return rows.map((r) => ({
    controlId: r.id,
    code: r.code,
    title: r.title,
    domain: r.domain,
    confidenceScore: Math.max(0, Math.min(1, r.score)),
  }));
}
