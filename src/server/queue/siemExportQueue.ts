// Phase 8 Part 2 — SIEM export queue. Lightweight secondary jobs enqueued
// by the audit worker AFTER the DB write succeeds; BullMQ retries with
// exponential backoff (max 5), and terminally-failed jobs are copied to a
// dead-letter queue so they are alertable, never silently dropped.
import { Queue } from "bullmq";
import { env } from "@/env";

export const SIEM_EXPORT_QUEUE_NAME = "siem-export";
export const SIEM_EXPORT_FAILED_QUEUE_NAME = "siem-export-failed";

export interface SiemExportJobData {
  auditLogId: string;
  organizationId: string;
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

export const siemExportQueue = new Queue<SiemExportJobData>(
  SIEM_EXPORT_QUEUE_NAME,
  {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2_000 },
    },
  },
);

/** Dead-letter queue: no worker consumes it — it is an inspection buffer. */
export const siemExportFailedQueue = new Queue<
  SiemExportJobData & { error: string; failedAt: string }
>(SIEM_EXPORT_FAILED_QUEUE_NAME, { connection: redisConnection() });

export async function enqueueSiemExport(data: SiemExportJobData) {
  await siemExportQueue.add("export", data);
}
