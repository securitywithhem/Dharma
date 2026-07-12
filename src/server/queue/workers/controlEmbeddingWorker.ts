/**
 * src/server/queue/workers/controlEmbeddingWorker.ts
 *
 * Phase 6 Part 2 — processes "embed-control" jobs: embeds a single control's
 * title+description text (see controlEmbeddingText) and persists it onto
 * Control.embedding. Async and non-blocking with respect to control
 * create/update — embedding failure never surfaces to the CRUD caller.
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { embedControl } from "@/server/services/controlEmbeddings";
import { CONTROL_EMBEDDING_QUEUE_NAME, type ControlEmbeddingJobData } from "@/server/queue/controlEmbeddingQueue";

declare global {
  // eslint-disable-next-line no-var
  var __controlEmbeddingWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__controlEmbeddingWorkerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__controlEmbeddingWorkerPrisma = prisma;
}

/** Redis connection options from env (matches connectorQueue.ts). */
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

async function processControlEmbeddingJob(job: Job<ControlEmbeddingJobData>) {
  await embedControl(prisma, job.data.controlId);
  return { controlId: job.data.controlId };
}

export function startControlEmbeddingWorker() {
  const concurrency = Number(process.env.CONTROL_EMBEDDING_WORKER_CONCURRENCY) || 2;

  const worker = new Worker<ControlEmbeddingJobData>(
    CONTROL_EMBEDDING_QUEUE_NAME,
    processControlEmbeddingJob,
    {
      connection: redisConnection(),
      concurrency,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[embed-control] ✅ job ${job.id} completed (control ${job.data.controlId})`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[embed-control] ❌ job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[embed-control] worker error:", err);
  });

  console.log(`[embed-control] worker started — queue="${CONTROL_EMBEDDING_QUEUE_NAME}" concurrency=${concurrency}`);
  return worker;
}
