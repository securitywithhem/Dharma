/**
 * src/workers/connectors/index.ts
 *
 * Phase 2 Feature 2 — BullMQ connector-sync worker & queue.
 *
 * Dispatches each connector run to the correct provider handler.
 * Runs on a configurable cron schedule (default every 12h).
 * Single-org/connector immediate runs triggered by connector.runNow.
 *
 * [skills: backend-dev-guidelines, container-security-hardening]
 */

import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient, ConnectorType, ConnectorStatus } from "@prisma/client";
import { env } from "@/env";
import { runGitHubConnector } from "./github";
import { runAWSConnector } from "./aws";
import { runVercelConnector } from "./vercel";

// ------------------------------------------------------------------
// Prisma singleton
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __connectorWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient =
  globalThis.__connectorWorkerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__connectorWorkerPrisma = prisma;
}

// ------------------------------------------------------------------
// Queue definition
// ------------------------------------------------------------------

export const CONNECTOR_QUEUE_NAME = "connector-sync";

export interface ConnectorJobData {
  /** Run all active connectors when null; run a specific one when set. */
  connectorId: string | null;
  /** Used together with connectorId to scope the run. */
  organizationId: string | null;
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

export const connectorQueue = new Queue<ConnectorJobData>(CONNECTOR_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 120_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 50 },
  },
});

// ------------------------------------------------------------------
// Job processor
// ------------------------------------------------------------------

async function processConnectorJob(
  job: Job<ConnectorJobData>,
): Promise<{ processed: number }> {
  const { connectorId, organizationId } = job.data;

  // Fetch the target connector(s)
  const connectors = await prisma.connector.findMany({
    where: {
      ...(connectorId ? { id: connectorId } : {}),
      ...(organizationId ? { organizationId } : {}),
      status: { not: ConnectorStatus.DISCONNECTED },
    },
  });

  if (connectors.length === 0) {
    console.log(`[connector-sync] No active connectors found for job ${job.id}`);
    return { processed: 0 };
  }

  // Find a fallback control per org (attach evidence to the first available control)
  const orgIds = [...new Set(connectors.map((c) => c.organizationId))];
  const defaultControls: Record<string, string> = {};

  for (const orgId of orgIds) {
    const control = await prisma.control.findFirst({
      where: { framework: { organizationId: orgId } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (control) defaultControls[orgId] = control.id;
  }

  let processed = 0;

  for (const connector of connectors) {
    const defaultControlId = defaultControls[connector.organizationId];
    if (!defaultControlId) {
      console.warn(
        `[connector-sync] No controls found for org ${connector.organizationId} — skipping connector ${connector.id}`,
      );
      continue;
    }

    try {
      // Legacy Phase 2 sync runners still use the separate `credentials` column
      // (see src/lib/crypto/credentials.ts) rather than the Part 1 `config` vault.
      if (!connector.credentials) {
        throw new Error(`Connector ${connector.id} has no legacy credentials configured`);
      }
      const legacyConnector = { ...connector, credentials: connector.credentials };

      switch (connector.type) {
        case ConnectorType.GITHUB:
          await runGitHubConnector(prisma, legacyConnector, defaultControlId);
          break;
        case ConnectorType.AWS:
          await runAWSConnector(prisma, legacyConnector, defaultControlId);
          break;
        case ConnectorType.VERCEL:
          await runVercelConnector(prisma, legacyConnector, defaultControlId);
          break;
        default:
          console.warn(`[connector-sync] Unsupported legacy sync provider: ${connector.type}`);
      }
      processed++;
    } catch (err) {
      console.error(
        `[connector-sync] ❌ Error processing connector ${connector.id}:`,
        err instanceof Error ? err.message : err,
      );
      // Mark connector as errored
      await prisma.connector.update({
        where: { id: connector.id },
        data: {
          status: ConnectorStatus.ERROR,
          lastSyncAt: new Date(),
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  return { processed };
}

// ------------------------------------------------------------------
// Worker factory
// ------------------------------------------------------------------

/**
 * Start the BullMQ connector-sync worker with a repeatable scheduled job.
 */
export function startConnectorWorker() {
  const worker = new Worker<ConnectorJobData>(CONNECTOR_QUEUE_NAME, processConnectorJob, {
    connection: redisConnection(),
    concurrency: 3, // run up to 3 connectors in parallel
  });

  worker.on("completed", (job, result) => {
    console.log(`[connector-sync] ✅ Job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[connector-sync] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[connector-sync] Worker error:", err);
  });

  // Register repeatable job
  connectorQueue
    .add(
      "scheduled-sync-all",
      { connectorId: null, organizationId: null },
      {
        repeat: { pattern: env.CONNECTOR_SYNC_CRON },
        jobId: "scheduled-connector-sync-all",
      },
    )
    .then(() => {
      console.log(
        `[connector-sync] Repeatable job registered — cron="${env.CONNECTOR_SYNC_CRON}"`,
      );
    })
    .catch((err) => {
      console.error("[connector-sync] Failed to register repeatable job:", err);
    });

  console.log(`[connector-sync] Worker started — queue="${CONNECTOR_QUEUE_NAME}"`);
  return worker;
}
