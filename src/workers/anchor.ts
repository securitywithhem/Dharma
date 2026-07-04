/**
 * src/workers/anchor.ts
 *
 * Phase 2 Feature 3 — BullMQ worker that periodically anchors each org's
 * audit chain root hash to WORM storage (and optionally OpenTimestamps).
 *
 * Schedule: every 6 hours by default (ANCHOR_INTERVAL_CRON env var).
 * Manual trigger available via audit.triggerManualAnchor tRPC procedure.
 *
 * [skills: backend-dev-guidelines, container-security-hardening]
 */

import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { anchorRootHash } from "@/lib/services/chainAnchor";

// ------------------------------------------------------------------
// Prisma singleton
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __anchorWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__anchorWorkerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__anchorWorkerPrisma = prisma;
}

// ------------------------------------------------------------------
// Queue
// ------------------------------------------------------------------

export const ANCHOR_QUEUE_NAME = "anchor-chain";

export interface AnchorJobData {
  /** When set, only anchor a single org. When null, iterate all orgs. */
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

export const anchorQueue = new Queue<AnchorJobData>(ANCHOR_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 60_000 }, // 1-min retry
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 50 },
  },
});

// ------------------------------------------------------------------
// Job processor
// ------------------------------------------------------------------

async function processAnchorJob(job: Job<AnchorJobData>): Promise<{ anchored: number }> {
  const { organizationId } = job.data;

  let orgs: { id: string }[];
  if (organizationId) {
    orgs = [{ id: organizationId }];
  } else {
    orgs = await prisma.organization.findMany({ select: { id: true } });
  }

  console.log(`[anchor] ▶ Job ${job.id}: anchoring ${orgs.length} org(s)`);

  let anchored = 0;
  for (const org of orgs) {
    try {
      await anchorRootHash(prisma, org.id);
      anchored++;
    } catch (err) {
      console.error(
        `[anchor] ❌ Failed to anchor org ${org.id}:`,
        err instanceof Error ? err.message : err,
      );
      // Don't throw — continue anchoring other orgs
    }
  }

  console.log(`[anchor] ✅ Job ${job.id}: anchored ${anchored}/${orgs.length} org(s)`);
  return { anchored };
}

// ------------------------------------------------------------------
// Worker factory
// ------------------------------------------------------------------

/**
 * Start the BullMQ anchor worker with a repeatable scheduled job.
 * Call from src/workers/index.ts worker bootstrap.
 */
export function startAnchorWorker() {
  const worker = new Worker<AnchorJobData>(ANCHOR_QUEUE_NAME, processAnchorJob, {
    connection: redisConnection(),
    concurrency: 1, // serial — avoid simultaneous anchor writes for same org
  });

  worker.on("completed", (job, result) => {
    console.log(`[anchor] ✅ Job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[anchor] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[anchor] Worker error:", err);
  });

  // Register the repeatable scheduled job (runs on all orgs)
  anchorQueue
    .add(
      "scheduled-anchor-all",
      { organizationId: null },
      {
        repeat: { pattern: env.ANCHOR_INTERVAL_CRON },
        jobId: "scheduled-anchor-all", // stable ID prevents duplicates on restart
      },
    )
    .then(() => {
      console.log(
        `[anchor] Repeatable job registered — cron="${env.ANCHOR_INTERVAL_CRON}"`,
      );
    })
    .catch((err) => {
      console.error("[anchor] Failed to register repeatable job:", err);
    });

  console.log(`[anchor] Worker started — queue="${ANCHOR_QUEUE_NAME}"`);
  return worker;
}

// ------------------------------------------------------------------
// Standalone entrypoint
// ------------------------------------------------------------------

if (require.main === module) {
  const worker = startAnchorWorker();
  process.on("SIGTERM", async () => {
    console.log("[anchor] SIGTERM — draining worker…");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
