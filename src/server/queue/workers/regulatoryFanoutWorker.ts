// Phase 9 Part 3 — regulatory fanout worker.
//
// For a newly-published FrameworkVersion, creates a RegulatoryAlert for EVERY
// org that imported that framework (ImportedItem.marketplaceItemId match) and
// only those orgs — no leakage to unrelated orgs (the fanout target set IS
// the org-isolation boundary; covered by tests). Each alert creation is
// idempotent via the unique [organizationId, frameworkVersionId] constraint,
// audited, and optionally fires the org's regulatory.alert_created webhooks.
import { Worker, type Job } from "bullmq";
import { PrismaClient, Prisma } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { notifyRegulatoryAlertCreated } from "@/server/connectors/notify";
import {
  REGULATORY_FANOUT_QUEUE_NAME,
  type RegulatoryFanoutJobData,
} from "@/server/queue/regulatoryQueue";
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

export function createRegulatoryFanoutProcessor(prisma: PrismaClient) {
  return async (job: Job<RegulatoryFanoutJobData>) => {
    const { frameworkVersionId, marketplaceItemId, version, diff } = job.data;
    const diffSummary = diff ?? { added: [], removed: [], modified: [] };

    // Every org that imported this framework — the ONLY orgs that get alerted.
    const importers = await prisma.importedItem.findMany({
      where: { marketplaceItemId },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });

    let created = 0;
    for (const { organizationId } of importers) {
      // Idempotent: the unique [organizationId, frameworkVersionId] constraint
      // means a re-run (or retry) never double-alerts. Skip-on-conflict.
      let alertId: string | null = null;
      try {
        const alert = await prisma.regulatoryAlert.create({
          data: {
            organizationId,
            frameworkVersionId,
            diffSummary: diffSummary as never,
          },
        });
        alertId = alert.id;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue; // already alerted this org for this version
        }
        throw error;
      }

      await emitAuditEvent(prisma, {
        organizationId,
        userId: null,
        action: "REGULATORY_ALERT_CREATED",
        entity: "RegulatoryAlert",
        entityId: alertId,
        changes: {
          actor: "regulatory-monitor",
          frameworkVersionId,
          version,
          added: diffSummary.added.length,
          removed: diffSummary.removed.length,
          modified: diffSummary.modified.length,
        },
      });

      // Optional webhook fan-out (reuses the existing dispatcher).
      await notifyRegulatoryAlertCreated(prisma, organizationId, {
        id: alertId,
        frameworkVersionId,
        version,
      }).catch((err) =>
        logger.warn({ err, organizationId, alertId }, "regulatory webhook enqueue failed"),
      );

      created += 1;
    }

    return { importers: importers.length, alertsCreated: created };
  };
}

export function startRegulatoryFanoutWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<RegulatoryFanoutJobData>(
    REGULATORY_FANOUT_QUEUE_NAME,
    createRegulatoryFanoutProcessor(prisma),
    { connection: redisConnection(), concurrency: Number(process.env.REGULATORY_WORKER_CONCURRENCY ?? 3) },
  );
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, frameworkVersionId: job?.data.frameworkVersionId },
      "regulatory fanout failed",
    );
  });
  return worker;
}
