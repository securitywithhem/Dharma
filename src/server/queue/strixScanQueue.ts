/**
 * src/server/queue/strixScanQueue.ts
 *
 * WAVE 12 — a dedicated queue for Strix (Deep Scan) runs.
 *
 * Why a separate queue rather than an `engine` field on `pentest-scan`:
 * a nuclei scan is minutes and a Strix scan is up to hours, so they cannot
 * share a concurrency pool without agentic runs starving quick scans of
 * workers. Separating them also lets the two carry the very different retry
 * economics documented below.
 */

import { Queue } from "bullmq";
import { env } from "@/env";

export const STRIX_SCAN_QUEUE_NAME = "strix-scan";

export interface StrixScanJobData {
  penTestId: string;
}

/** Redis connection options from env (matches pentestScanQueue.ts). */
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

export const strixScanQueue = new Queue<StrixScanJobData>(STRIX_SCAN_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    // ---------------------------------------------------------------------
    // Retry policy — deliberately NOT inherited from pentestScanQueue's
    // (attempts: 2, fixed 30s). Justification, since the brief asks for one:
    //
    // attempts: 1 (no retry). A nuclei retry is cheap and idempotent: same
    // templates, same requests, a few minutes. A Strix retry is neither. It
    // re-runs a non-deterministic LLM agent that actively exploits a live
    // production system, for up to two hours, at real per-run LLM cost. An
    // automatic retry therefore means firing a second uncoordinated attack at
    // a customer's infrastructure to recover from a transient error — and the
    // most common failure (a missing sandbox image, no LLM key) is an operator
    // problem that a retry cannot fix and would only obscure.
    //
    // A failed Deep Scan surfaces as PenTest.status = FAILED with an
    // actionable failureReason, and a human decides whether to run it again.
    // The one thing that must never happen — a scan stuck at RUNNING forever —
    // is handled by the worker persisting terminal state before it rethrows.
    // ---------------------------------------------------------------------
    attempts: 1,
    // Retained so a future operator raising `attempts` gets a sane backoff
    // rather than an immediate re-attack: 10 minutes, not nuclei's 30 seconds.
    backoff: { type: "fixed", delay: 600_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/**
 * BullMQ's own stall detection must outlast a legitimately long run, or a
 * healthy 90-minute scan gets declared stalled and re-queued mid-flight —
 * exactly the duplicate-attack outcome `attempts: 1` exists to prevent.
 * Consumed by the worker's `lockDuration`.
 */
export const STRIX_JOB_LOCK_MS = env.STRIX_SCAN_TIMEOUT_MS + 300_000;

/** BullMQ rejects custom job ids containing ":" — see pentestScanQueue.ts. */
function jobId(penTestId: string): string {
  return `strix-scan-${penTestId}`;
}

/** Enqueues a Deep Scan for an already-created, already-authorized PenTest row. */
export async function enqueueStrixScan(penTestId: string): Promise<string> {
  const job = await strixScanQueue.add("run-strix-scan", { penTestId }, { jobId: jobId(penTestId) });
  return job.id ?? "";
}

/**
 * Removes a queued (not yet started) Deep Scan. Returns false when the job is
 * already running or gone — a running agent is stopped through the PenTest's
 * CANCELLED status, which the worker checks, not by yanking the job.
 */
export async function removeQueuedStrixJob(penTestId: string): Promise<boolean> {
  const job = await strixScanQueue.getJob(jobId(penTestId));
  if (!job) return false;
  const state = await job.getState();
  if (state !== "waiting" && state !== "delayed") return false;
  await job.remove();
  return true;
}
