/**
 * src/server/queue/workers/evidenceAutoTagWorker.ts
 *
 * Phase 7 Part 3 — evidence auto-tagging worker (PRD Phase 7). After an
 * evidence file is uploaded, this async job extracts its text (OCR for images,
 * text extraction for docs), embeds it, and finds the org's most similar
 * Control descriptions to SUGGEST additional control associations.
 *
 * SECURITY / AUDIT INVARIANT: this worker NEVER modifies `Evidence.controlId`
 * or creates a ControlMapping. It only writes SUGGESTIONS
 * (`suggestedControlIds`, `autoTagConfidence`, `autoTagStatus = SUGGESTED`).
 * A human must accept a suggestion (evidence.acceptAutoTag) for anything to be
 * persisted as a real association — preserving audit integrity.
 *
 * Core logic is exported as `processEvidenceAutoTag` with injectable deps so it
 * runs in tests without MinIO / Ollama / a DB.
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient, EvidenceType } from "@prisma/client";
import { env } from "@/env";
import { getFileBuffer } from "@/lib/storage/minioClient";
import { extractEvidenceText } from "@/server/ai/evidenceTextExtraction";
import { embedText } from "@/server/ai/embeddingClient";
import { EVIDENCE_AUTO_TAG_QUEUE_NAME, type EvidenceAutoTagJobData } from "@/server/queue/evidenceAutoTagQueue";

declare global {
  // eslint-disable-next-line no-var
  var __evidenceAutoTagWorkerPrisma: PrismaClient | undefined;
}
const prisma: PrismaClient = globalThis.__evidenceAutoTagWorkerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__evidenceAutoTagWorkerPrisma = prisma;
}

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

/** How many control suggestions to surface, and the minimum match to keep. */
const TOP_N = 3;
const MIN_CONFIDENCE = 0.6;

export interface SuggestedControl {
  controlId: string;
  code: string | null;
  title: string;
  confidence: number; // cosine similarity in [0,1]
}

export interface EvidenceAutoTagDeps {
  getBuffer?: (s3Key: string) => Promise<Buffer>;
  extractText?: (buffer: Buffer, mimeType: string, filename: string) => Promise<string>;
  embed?: (text: string, organizationId: string) => Promise<number[]>;
  findSimilarControls?: (organizationId: string, vector: number[], excludeControlId: string | null) => Promise<SuggestedControl[]>;
}

/** Default pgvector similarity search over Control.embedding, org-scoped. */
async function defaultFindSimilarControls(
  db: PrismaClient,
  organizationId: string,
  vector: number[],
  excludeControlId: string | null,
): Promise<SuggestedControl[]> {
  const rows = await db.$queryRawUnsafe<{ id: string; code: string | null; title: string; score: number }[]>(
    `SELECT c.id, c.code, c.title, 1 - (c.embedding <=> $1::vector) AS score
     FROM "Control" c
     JOIN "Framework" f ON f.id = c."frameworkId"
     WHERE f."organizationId" = $2
       AND c.embedding IS NOT NULL
       AND c.id <> $3
     ORDER BY c.embedding <=> $1::vector
     LIMIT $4`,
    `[${vector.join(",")}]`,
    organizationId,
    excludeControlId ?? "",
    TOP_N,
  );
  return rows.map((r) => ({
    controlId: r.id,
    code: r.code,
    title: r.title,
    confidence: Math.max(0, Math.min(1, Number(r.score))),
  }));
}

/** Best-effort MIME hint from the evidence type when the filename lacks an extension. */
function mimeHint(type: EvidenceType, fileName: string): string {
  if (/\.[a-z0-9]+$/i.test(fileName)) return "";
  return type === EvidenceType.SCREENSHOT ? "image/png" : "";
}

/**
 * Run auto-tagging for one evidence row. Writes suggestions only; never
 * mutates the evidence's real control association.
 */
export async function processEvidenceAutoTag(
  db: PrismaClient,
  evidenceId: string,
  deps: EvidenceAutoTagDeps = {},
): Promise<{ evidenceId: string; suggestions: SuggestedControl[] }> {
  const evidence = await db.evidence.findUnique({
    where: { id: evidenceId },
    select: { id: true, organizationId: true, controlId: true, fileName: true, filePath: true, type: true },
  });
  if (!evidence) return { evidenceId, suggestions: [] };

  try {
    await db.evidence.update({ where: { id: evidenceId }, data: { autoTagStatus: "PROCESSING" } });

    const buffer = await (deps.getBuffer ?? getFileBuffer)(evidence.filePath);
    const text = await (deps.extractText ?? extractEvidenceText)(buffer, mimeHint(evidence.type, evidence.fileName), evidence.fileName);

    if (!text || text.trim().length < 20) {
      // Not enough signal to suggest anything — mark processed, no suggestions.
      await db.evidence.update({
        where: { id: evidenceId },
        data: { autoTagStatus: "SUGGESTED", suggestedControlIds: [], autoTagConfidence: null },
      });
      return { evidenceId, suggestions: [] };
    }

    const embed = deps.embed ?? ((t: string, org: string) => embedText(t, { organizationId: org, prisma: db }));
    const vector = await embed(text, evidence.organizationId);

    const find = deps.findSimilarControls ?? ((org: string, vec: number[], exclude: string | null) => defaultFindSimilarControls(db, org, vec, exclude));
    const all = await find(evidence.organizationId, vector, evidence.controlId ?? null);
    const suggestions = all.filter((s) => s.confidence >= MIN_CONFIDENCE);

    // SUGGESTIONS ONLY — controlId is never touched here.
    await db.evidence.update({
      where: { id: evidenceId },
      data: {
        suggestedControlIds: suggestions as unknown as object,
        autoTagConfidence: suggestions[0]?.confidence ?? null,
        autoTagStatus: "SUGGESTED",
      },
    });
    return { evidenceId, suggestions };
  } catch (err) {
    console.warn(`[evidence-auto-tag] failed for ${evidenceId}:`, err instanceof Error ? err.message : String(err));
    await db.evidence.update({ where: { id: evidenceId }, data: { autoTagStatus: "FAILED" } }).catch(() => {});
    return { evidenceId, suggestions: [] };
  }
}

export function startEvidenceAutoTagWorker(): Worker<EvidenceAutoTagJobData> {
  const worker = new Worker<EvidenceAutoTagJobData>(
    EVIDENCE_AUTO_TAG_QUEUE_NAME,
    async (job: Job<EvidenceAutoTagJobData>) => processEvidenceAutoTag(prisma, job.data.evidenceId),
    { connection: redisConnection(), concurrency: 2 },
  );
  worker.on("failed", (job, err) => console.error(`[evidence-auto-tag] job ${job?.id} failed:`, err.message));
  console.log("✅ Evidence auto-tag worker started");
  return worker;
}
