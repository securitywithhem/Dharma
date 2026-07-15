// Phase 8 Part 2 — audit-event worker: performs the hash-chained AuditLog
// write off the request thread, feeds the correlation graph, and fans out
// to SIEM export when the org has a target configured.
//
// Deviation from the task brief, flagged in the summary: no multi-row batch
// INSERT. The audit chain (previousHash → currentHash under a per-org
// advisory lock) is inherently sequential per organization; batching across
// the chain would either break hash continuity or reimplement the lock.
// Moving the write off the request thread is what actually serves the
// p95 < 200ms goal.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { createAuditLog } from "@/server/audit-log";
import {
  AUDIT_EVENT_QUEUE_NAME,
  type AuditEventJobData,
} from "@/server/queue/auditEventQueue";
import { enqueueSiemExport } from "@/server/queue/siemExportQueue";
import { ingestAuditEventToGraph } from "@/server/services/audit/graph.service";
import { parseStoredSiemConfig } from "@/server/services/audit/siem-export";
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

export function createAuditEventProcessor(prisma: PrismaClient) {
  return async (job: Job<AuditEventJobData>) => {
    const { emittedAt, ...input } = job.data;

    const log = await createAuditLog(prisma, {
      ...input,
      changes: input.changes ?? null,
    });

    // Correlation graph is best-effort: a graph hiccup must never fail (and
    // therefore re-run) the canonical audit write.
    try {
      await ingestAuditEventToGraph(prisma, log);
    } catch (error) {
      logger.warn({ err: error, auditLogId: log.id }, "audit graph ingestion failed");
    }

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: input.organizationId },
      select: { siemExportConfig: true },
    });
    if (parseStoredSiemConfig(settings?.siemExportConfig)) {
      await enqueueSiemExport({
        auditLogId: log.id,
        organizationId: input.organizationId,
      });
    }

    return { auditLogId: log.id, queuedForMs: Date.now() - Date.parse(emittedAt) };
  };
}

export function startAuditEventWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<AuditEventJobData>(
    AUDIT_EVENT_QUEUE_NAME,
    createAuditEventProcessor(prisma),
    {
      connection: redisConnection(),
      // The per-org advisory lock already serializes chained writes within
      // an org; cross-org jobs can proceed in parallel.
      concurrency: Number(process.env.AUDIT_WORKER_CONCURRENCY ?? 5),
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, action: job?.data.action },
      "audit event write failed",
    );
  });

  return worker;
}
