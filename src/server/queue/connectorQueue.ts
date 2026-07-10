import { Queue } from "bullmq";
import { env } from "@/env";

export const CONNECTOR_EVIDENCE_QUEUE_NAME = "connector-evidence-collection";

export interface ConnectorEvidenceJobData {
  evidenceMappingId: string;
  /** true for a "Collect now" trigger — bypasses the idempotency window guard. */
  manual?: boolean;
}

/** Redis connection options from env (matches src/workers/classification.ts). */
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

export const connectorEvidenceQueue = new Queue<ConnectorEvidenceJobData>(
  CONNECTOR_EVIDENCE_QUEUE_NAME,
  {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  },
);

/** Stable BullMQ job id for a mapping's repeatable schedule. */
function repeatableJobId(mappingId: string): string {
  return `mapping:${mappingId}`;
}

/**
 * Registers (or re-registers) the repeatable job for a mapping's schedule.
 * Removes any existing repeatable job for this mapping first — BullMQ keys
 * repeatable jobs by (name, pattern, jobId), so changing the cron pattern
 * without removing the old entry would leave two schedules running.
 */
export async function addOrUpdateRepeatableJob(
  mappingId: string,
  cron: string,
): Promise<void> {
  await removeRepeatableJob(mappingId);

  await connectorEvidenceQueue.add(
    "collect-evidence",
    { evidenceMappingId: mappingId },
    {
      jobId: repeatableJobId(mappingId),
      repeat: { pattern: cron },
    },
  );
}

/** Removes the repeatable job for a mapping, if one exists. No-op otherwise. */
export async function removeRepeatableJob(mappingId: string): Promise<void> {
  const jobId = repeatableJobId(mappingId);
  const repeatableJobs = await connectorEvidenceQueue.getRepeatableJobs();
  const match = repeatableJobs.find((job) => job.id === jobId);
  if (match) {
    await connectorEvidenceQueue.removeRepeatableByKey(match.key);
  }
}

/** Enqueues a one-off "Collect now" run, independent of the mapping's schedule. */
export async function enqueueImmediateCollection(
  mappingId: string,
): Promise<string> {
  const job = await connectorEvidenceQueue.add(
    "collect-evidence",
    { evidenceMappingId: mappingId, manual: true },
    { jobId: `mapping:${mappingId}:manual:${Date.now()}` },
  );
  return job.id ?? "";
}
