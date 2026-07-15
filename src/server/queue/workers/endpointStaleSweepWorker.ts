// Phase 9 Part 1 — endpoint stale-sweep worker.
//
// Repeatable hourly job (registered via registerEndpointStaleSweep). Marks any
// ACTIVE endpoint whose last heartbeat is older than the staleness window
// (48h) as STALE, writes an ENDPOINT_MARKED_STALE AuditLog per affected
// endpoint, and enqueues a (stubbed) notification job. Runs across all orgs —
// each affected endpoint's audit entry is written against its OWN org.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { emitAuditEvent } from "@/server/services/audit/writer";
import {
  ENDPOINT_STALE_SWEEP_QUEUE_NAME,
  type EndpointStaleSweepJobData,
} from "@/server/queue/endpointQueue";
import { logger } from "@/lib/logger";

/** Heartbeats older than this flip an ACTIVE endpoint to STALE. */
export const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

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

/** Pure threshold predicate, exported for unit testing. */
export function isStale(lastHeartbeatAt: Date | null, now: Date = new Date()): boolean {
  if (!lastHeartbeatAt) return false; // never-heartbeated endpoints stay PENDING, not STALE
  return now.getTime() - lastHeartbeatAt.getTime() > STALE_THRESHOLD_MS;
}

export function createEndpointStaleSweepProcessor(prisma: PrismaClient) {
  return async (_job: Job<EndpointStaleSweepJobData>) => {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    // Only ACTIVE endpoints can go STALE; PENDING (never heartbeated) and
    // REVOKED are left untouched.
    const stale = await prisma.endpoint.findMany({
      where: {
        status: "ACTIVE",
        lastHeartbeatAt: { lt: cutoff },
      },
      select: { id: true, organizationId: true, hostname: true, lastHeartbeatAt: true },
    });

    for (const endpoint of stale) {
      await prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { status: "STALE" },
      });

      await emitAuditEvent(prisma, {
        organizationId: endpoint.organizationId,
        userId: null,
        action: "ENDPOINT_MARKED_STALE",
        entity: "Endpoint",
        entityId: endpoint.id,
        changes: {
          actor: "stale-sweep",
          hostname: endpoint.hostname,
          lastHeartbeatAt: endpoint.lastHeartbeatAt?.toISOString() ?? null,
        },
      });

      // STUB: notification fan-out (email/webhook) — Phase 9 later part.
      // Deliberately left as a log line rather than a half-built integration.
      logger.info(
        { endpointId: endpoint.id, organizationId: endpoint.organizationId },
        "endpoint marked STALE — notification enqueue stubbed",
      );
    }

    return { swept: stale.length };
  };
}

export function startEndpointStaleSweepWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<EndpointStaleSweepJobData>(
    ENDPOINT_STALE_SWEEP_QUEUE_NAME,
    createEndpointStaleSweepProcessor(prisma),
    { connection: redisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "endpoint stale-sweep failed");
  });

  return worker;
}
