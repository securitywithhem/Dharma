import { Queue } from "bullmq";
import { env } from "@/env";

export const READINESS_SCORE_QUEUE_NAME = "compute-readiness-score";
/** Repeatable daily sweep job name/id, distinct from per-framework compute jobs. */
const DAILY_SWEEP_JOB_ID = "daily-sweep";

export interface ReadinessScoreJobData {
  organizationId: string;
  frameworkId: string;
}

/** Redis connection options from env (matches connectorQueue.ts / controlEmbeddingQueue.ts). */
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

export const readinessScoreQueue = new Queue<ReadinessScoreJobData>(READINESS_SCORE_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/**
 * Stable per-(org, framework) job id, so rapid successive triggers coalesce.
 * BullMQ rejects custom job ids containing `:` (used internally as a Redis
 * key delimiter), so `-` is used instead — safe since cuids are lowercase
 * alphanumeric only and never contain a hyphen themselves.
 */
function debounceJobId(organizationId: string, frameworkId: string): string {
  return `${organizationId}-${frameworkId}`;
}

/**
 * Debounced enqueue: a short delay before the job runs, keyed by a stable
 * (org, framework) job id. If a job with that id is already waiting/delayed,
 * BullMQ's job-id uniqueness means this call is a no-op rather than creating
 * a duplicate — so several Evidence/ControlMapping mutations firing in quick
 * succession collapse into a single recompute. Once a job is actively
 * processing or completed, a fresh call is free to enqueue the next one.
 */
export async function enqueueReadinessRecompute(
  organizationId: string,
  frameworkId: string,
  delayMs = 5000,
): Promise<void> {
  try {
    await readinessScoreQueue.add(
      "compute",
      { organizationId, frameworkId },
      { jobId: debounceJobId(organizationId, frameworkId), delay: delayMs },
    );
  } catch (err) {
    // BullMQ throws if a job with this id already exists in a terminal-adjacent
    // state race; since the whole point is "only one pending recompute per
    // framework," swallowing this is the correct behavior, not an error.
    console.warn(`[readiness-score] enqueue debounce no-op for ${organizationId}:${frameworkId}:`, err);
  }
}

export { DAILY_SWEEP_JOB_ID };
