/**
 * src/server/queue/aiIngestionQueue.ts
 *
 * Phase 7 Part 1 — queue for the AI Advisor document-ingestion pipeline.
 * Mirrors src/server/queue/controlEmbeddingQueue.ts exactly (Redis connection
 * derivation, default job options).
 */

import { Queue } from "bullmq";
import { env } from "@/env";

export const AI_INGESTION_QUEUE_NAME = "ai-ingestion";

export interface AiIngestionJobData {
  /** IngestedDocument.id to process. */
  documentId: string;
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

export const aiIngestionQueue = new Queue<AiIngestionJobData>(AI_INGESTION_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    // Ingestion is idempotent (the worker prunes partial rows on failure before
    // marking FAILED), so retries are safe.
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/** Enqueue a document for ingestion. */
export async function enqueueAiIngestion(documentId: string): Promise<void> {
  await aiIngestionQueue.add("ai-ingestion", { documentId }, { jobId: documentId });
}
