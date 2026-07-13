/**
 * src/server/queue/evidenceAutoTagQueue.ts
 *
 * Phase 7 Part 3 — queue for NLP evidence auto-tagging (PRD Phase 7). Mirrors
 * src/server/queue/aiIngestionQueue.ts exactly. Fully async/background so it
 * never blocks the evidence-upload response (2_TRD.md "Async & event-driven").
 */

import { Queue } from "bullmq";
import { env } from "@/env";

export const EVIDENCE_AUTO_TAG_QUEUE_NAME = "evidence-auto-tag";

export interface EvidenceAutoTagJobData {
  evidenceId: string;
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

export const evidenceAutoTagQueue = new Queue<EvidenceAutoTagJobData>(EVIDENCE_AUTO_TAG_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 4000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/** Enqueue an evidence row for auto-tag suggestion. Fire-and-forget. */
export async function enqueueEvidenceAutoTag(evidenceId: string): Promise<void> {
  await evidenceAutoTagQueue.add("evidence-auto-tag", { evidenceId }, { jobId: `autotag-${evidenceId}` });
}
