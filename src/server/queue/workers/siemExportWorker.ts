// Phase 8 Part 2 — SIEM export worker. Reads the audit row + org config at
// send time (config rotations apply immediately) and forwards to Splunk HEC
// or syslog. Terminal failures are copied to the dead-letter queue with the
// error message and loudly logged — never silently dropped.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import {
  SIEM_EXPORT_QUEUE_NAME,
  siemExportFailedQueue,
  type SiemExportJobData,
} from "@/server/queue/siemExportQueue";
import {
  exportAuditEvent,
  parseStoredSiemConfig,
} from "@/server/services/audit/siem-export";
import { logger } from "@/lib/logger";

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

export function createSiemExportProcessor(prisma: PrismaClient) {
  return async (job: Job<SiemExportJobData>) => {
    const { auditLogId, organizationId } = job.data;

    const [log, settings] = await Promise.all([
      prisma.auditLog.findFirst({ where: { id: auditLogId, organizationId } }),
      prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { siemExportConfig: true },
      }),
    ]);

    if (!log) {
      logger.warn({ auditLogId }, "siem export: audit row vanished — skipping");
      return;
    }
    const config = parseStoredSiemConfig(settings?.siemExportConfig);
    if (!config) {
      // Export was disabled between enqueue and processing — not an error.
      return;
    }

    await exportAuditEvent(log, config);
  };
}

export function startSiemExportWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<SiemExportJobData>(
    SIEM_EXPORT_QUEUE_NAME,
    createSiemExportProcessor(prisma),
    {
      connection: redisConnection(),
      concurrency: Number(process.env.SIEM_EXPORT_WORKER_CONCURRENCY ?? 5),
    },
  );

  worker.on("failed", (job, error) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts.attempts ?? 1;
    logger.error(
      { err: error, jobId: job?.id, attemptsMade, auditLogId: job?.data.auditLogId },
      "siem export attempt failed",
    );
    if (job && attemptsMade >= maxAttempts) {
      void siemExportFailedQueue
        .add("dead-letter", {
          ...job.data,
          error: error.message,
          failedAt: new Date().toISOString(),
        })
        .catch((dlqError) =>
          logger.error({ err: dlqError }, "failed to dead-letter siem export job"),
        );
    }
  });

  return worker;
}
