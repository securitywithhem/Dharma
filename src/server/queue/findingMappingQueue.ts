/**
 * src/server/queue/findingMappingQueue.ts
 *
 * WAVE 12 — queue for `mapFindingsToControls` jobs.
 *
 * The brief allows sharing the existing embedding queue "if its design supports
 * multi-purpose jobs". It does not: `controlEmbeddingQueue`'s payload is
 * `{ controlId }` and its worker embeds a Control, full stop. Widening it into
 * a union payload would make one worker responsible for two unrelated
 * lifecycles. So this is the "thin dedicated queue that calls the same
 * embedding service" alternative — no second embedding path is created; the
 * mapper reuses embedVulnerability/Control.embedding exactly as they are.
 *
 * Kept separate from scan ingestion for the reason the brief gives: a slow
 * embedding lookup must never block a scan from recording its findings.
 */

import { Queue } from "bullmq";
import { env } from "@/env";

export const FINDING_MAPPING_QUEUE_NAME = "map-findings-to-controls";

export interface FindingMappingJobData {
  vulnerabilityId: string;
}

/** Redis connection options from env (matches controlEmbeddingQueue.ts). */
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

export const findingMappingQueue = new Queue<FindingMappingJobData>(FINDING_MAPPING_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    // Unlike a scan, this IS cheap and safe to retry: it reaches Ollama and
    // Postgres, not the customer's infrastructure, and the mapper is
    // idempotent (the unique constraint on (vulnerabilityId, controlId) makes
    // a duplicate suggestion a no-op). Exponential backoff rides out an
    // embedding service that is briefly down.
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

/** Enqueues control mapping for one newly created finding. */
export async function enqueueFindingMapping(vulnerabilityId: string): Promise<void> {
  await findingMappingQueue.add(
    "map-finding",
    { vulnerabilityId },
    // Deduplicated by vulnerability: re-ingesting or re-running must not queue
    // the same mapping work twice.
    { jobId: `map-finding-${vulnerabilityId}` },
  );
}
