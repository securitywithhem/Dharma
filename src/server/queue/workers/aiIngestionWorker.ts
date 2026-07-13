/**
 * src/server/queue/workers/aiIngestionWorker.ts
 *
 * Phase 7 Part 1 — AI Advisor ingestion worker.
 *
 * Pipeline (per IngestedDocument):
 *   PENDING → CHUNKING → EMBEDDING → GRAPH_EXTRACTING → COMPLETED
 *
 *   1. Load the document; set CHUNKING.
 *   2. Pull bytes from MinIO, extract raw text.
 *   3. Chunk the text.
 *   4. Set EMBEDDING; embed all chunks (per-org provider), write
 *      OrganizationEmbedding rows (vector via raw SQL, same idiom as
 *      controlEmbeddings.ts).
 *   5. Set GRAPH_EXTRACTING; extract + persist the org-scoped knowledge graph,
 *      then stamp each chunk's metadata with the graph node ids it references.
 *   6. Set COMPLETED; record chunkCount + graphNodeCount.
 *
 * Idempotency: at the start of every run, and on any failure, all embeddings
 * and graph rows for the document are deleted, so a BullMQ retry re-runs
 * cleanly and no partial rows survive a FAILED document.
 *
 * The core pipeline is exported as `processIngestionDocument` with injectable
 * dependencies, so it can be driven synchronously in tests against just a
 * Postgres DB (no Redis / Ollama / MinIO required).
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { createAuditLog } from "@/server/audit-log";
import { getFileBuffer } from "@/lib/storage/minioClient";
import { extractText as defaultExtractText } from "@/server/ai/textExtraction";
import { chunkDocument } from "@/server/ai/chunking";
import { embedBatch } from "@/server/ai/embeddingClient";
import { extractAndPersistGraph, pruneGraphForDocument } from "@/server/ai/graphExtraction";
import { resolveInferenceProvider } from "@/lib/ai/resolveProvider";
import type { InferenceProvider } from "@/lib/ai/InferenceProvider";
import { AI_INGESTION_QUEUE_NAME, type AiIngestionJobData } from "@/server/queue/aiIngestionQueue";

// ------------------------------------------------------------------
// Prisma singleton (matches connectorEvidenceWorker.ts convention)
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __aiIngestionWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__aiIngestionWorkerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__aiIngestionWorkerPrisma = prisma;
}

/** Redis connection options from env (matches connectorQueue.ts). */
function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

const DOCUMENT_TYPE = "policy_doc" as const;

/** Injectable dependencies — real implementations by default, overridable in tests. */
export interface IngestionDeps {
  getBuffer?: (s3Key: string) => Promise<Buffer>;
  extractText?: (buffer: Buffer, mimeType: string, filename: string) => Promise<string>;
  /** Returns one 384-dim vector per input text, order-preserving. */
  embedTexts?: (texts: string[], organizationId: string) => Promise<number[][]>;
  /**
   * Provider used for LLM graph extraction. `undefined` → resolve the org's
   * provider; `null` → force the deterministic heuristic (used in tests).
   */
  provider?: InferenceProvider | null;
}

export interface IngestionResult {
  documentId: string;
  status: "COMPLETED";
  chunkCount: number;
  graphNodeCount: number;
}

/** Remove any embeddings + graph rows for a document (idempotency / cleanup). */
async function purgeArtifacts(db: PrismaClient, organizationId: string, documentId: string): Promise<void> {
  await db.organizationEmbedding.deleteMany({ where: { sourceDocumentId: documentId } });
  await pruneGraphForDocument(db, organizationId, documentId);
}

/**
 * Run the full ingestion pipeline for one document. Exported for direct,
 * synchronous use in tests.
 */
export async function processIngestionDocument(
  db: PrismaClient,
  documentId: string,
  deps: IngestionDeps = {},
): Promise<IngestionResult> {
  const doc = await db.ingestedDocument.findUnique({ where: { id: documentId } });
  if (!doc) {
    throw new Error(`IngestedDocument ${documentId} not found`);
  }
  const { organizationId, uploadedById, s3Key, mimeType, filename } = doc;

  try {
    // Start clean so a retry never doubles up rows.
    await purgeArtifacts(db, organizationId, documentId);

    // 1. CHUNKING — fetch + extract + chunk
    await db.ingestedDocument.update({ where: { id: documentId }, data: { status: "CHUNKING", error: null } });
    const buffer = await (deps.getBuffer ?? getFileBuffer)(s3Key);
    const text = await (deps.extractText ?? defaultExtractText)(buffer, mimeType, filename);
    const chunks = chunkDocument(text);
    if (chunks.length === 0) {
      throw new Error("Document produced no text chunks (empty or unextractable content)");
    }

    // 2. EMBEDDING — embed chunks + persist rows (vector via raw SQL)
    await db.ingestedDocument.update({ where: { id: documentId }, data: { status: "EMBEDDING" } });
    const embedFn =
      deps.embedTexts ?? ((texts: string[], orgId: string) => embedBatch(texts, { organizationId: orgId, prisma: db, batchSize: 20 }));
    const vectors = await embedFn(chunks.map((c) => c.content), organizationId);
    if (vectors.length !== chunks.length) {
      throw new Error(`Embedding count ${vectors.length} != chunk count ${chunks.length}`);
    }

    const persisted: { id: string; content: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || vec.length !== 384) {
        throw new Error(`Chunk ${i} embedding has wrong dimension: ${Array.isArray(vec) ? vec.length : "n/a"}`);
      }
      const row = await db.organizationEmbedding.create({
        data: {
          organizationId,
          documentType: DOCUMENT_TYPE,
          documentId,
          sourceDocumentId: documentId,
          chunkIndex: chunks[i].index,
          content: chunks[i].content,
          metadata: { tokenEstimate: chunks[i].tokenEstimate },
        },
        select: { id: true },
      });
      await db.$executeRawUnsafe(
        `UPDATE "OrganizationEmbedding" SET embedding = $1::vector WHERE id = $2`,
        `[${vec.join(",")}]`,
        row.id,
      );
      persisted.push({ id: row.id, content: chunks[i].content });
    }

    // 3. GRAPH_EXTRACTING — extract + persist the org-scoped graph
    await db.ingestedDocument.update({ where: { id: documentId }, data: { status: "GRAPH_EXTRACTING" } });
    let graphProvider: InferenceProvider | undefined;
    if (deps.provider === null) {
      graphProvider = undefined; // forced heuristic
    } else if (deps.provider) {
      graphProvider = deps.provider;
    } else {
      try {
        graphProvider = await resolveInferenceProvider(db, organizationId);
      } catch {
        graphProvider = undefined;
      }
    }
    const graph = await extractAndPersistGraph(db, {
      organizationId,
      sourceDocumentId: documentId,
      text,
      provider: graphProvider,
    });

    // Cross-reference: stamp each chunk with the graph nodes it mentions.
    const labelIds = Array.from(graph.nodeIdByLabel.entries()); // [labelLower, nodeId]
    if (labelIds.length > 0) {
      for (const row of persisted) {
        const lc = row.content.toLowerCase();
        const ids = labelIds.filter(([label]) => label.length > 0 && lc.includes(label)).map(([, id]) => id);
        if (ids.length > 0) {
          await db.organizationEmbedding.update({
            where: { id: row.id },
            data: { metadata: { graphNodeId: ids[0], graphNodeIds: ids } },
          });
        }
      }
    }

    // 4. COMPLETED
    await db.ingestedDocument.update({
      where: { id: documentId },
      data: { status: "COMPLETED", chunkCount: chunks.length, graphNodeCount: graph.nodeCount, error: null },
    });

    return { documentId, status: "COMPLETED", chunkCount: chunks.length, graphNodeCount: graph.nodeCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No partial rows may survive a FAILED document.
    await purgeArtifacts(db, organizationId, documentId).catch(() => {});
    await db.ingestedDocument
      .update({ where: { id: documentId }, data: { status: "FAILED", error: message.slice(0, 2000) } })
      .catch(() => {});
    await createAuditLog(db, {
      organizationId,
      userId: uploadedById,
      // House audit-action convention is SCREAMING_SNAKE_CASE; this is the
      // "ai_ingestion.failed" event the ingestion spec asks for.
      action: "AI_INGESTION_FAILED",
      entity: "IngestedDocument",
      entityId: documentId,
      changes: { error: message.slice(0, 500) },
    }).catch((e) => console.error("[ai-ingestion] failed to write audit log:", e));
    throw err;
  }
}

/** Start the BullMQ worker. Registered from src/workers/index.ts. */
export function startAiIngestionWorker(): Worker<AiIngestionJobData> {
  const worker = new Worker<AiIngestionJobData>(
    AI_INGESTION_QUEUE_NAME,
    async (job: Job<AiIngestionJobData>) => {
      return processIngestionDocument(prisma, job.data.documentId);
    },
    {
      connection: redisConnection(),
      concurrency: env.OLLAMA_WORKER_CONCURRENCY ?? 2,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[ai-ingestion] job ${job?.id} failed:`, err.message);
  });

  console.log("✅ AI ingestion worker started");
  return worker;
}
