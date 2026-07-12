/**
 * src/server/queue/workers/readinessScoreWorker.ts
 *
 * Phase 6 Part 3 — processes "compute-readiness-score" jobs: recomputes and
 * upserts a framework's ReadinessScore, then regenerates its recommendations
 * from the same leaf facts. Also runs the daily sweep repeatable job, which
 * enumerates every framework and enqueues a debounced compute job for each —
 * one repeatable registration rather than one per (org, framework) pair, so
 * new frameworks are picked up automatically without re-registering jobs.
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { computeReadinessScore, generateRecommendations } from "@/server/services/readinessScoring";
import {
  READINESS_SCORE_QUEUE_NAME,
  enqueueReadinessRecompute,
  type ReadinessScoreJobData,
} from "@/server/queue/readinessScoreQueue";

declare global {
  // eslint-disable-next-line no-var
  var __readinessScoreWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__readinessScoreWorkerPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__readinessScoreWorkerPrisma = prisma;
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

async function processReadinessScoreJob(job: Job<ReadinessScoreJobData, unknown, string>) {
  if (job.name === "daily-sweep") {
    const frameworks = await prisma.framework.findMany({ select: { id: true, organizationId: true } });
    await Promise.all(frameworks.map((f) => enqueueReadinessRecompute(f.organizationId, f.id)));
    return { sweptFrameworks: frameworks.length };
  }

  const { organizationId, frameworkId } = job.data;
  const result = await computeReadinessScore(prisma, organizationId, frameworkId);
  await generateRecommendations(prisma, organizationId, frameworkId);
  return { overallScore: result.overallScore };
}

export function startReadinessScoreWorker() {
  const concurrency = Number(process.env.READINESS_SCORE_WORKER_CONCURRENCY) || 2;

  const worker = new Worker<ReadinessScoreJobData, unknown, string>(
    READINESS_SCORE_QUEUE_NAME,
    processReadinessScoreJob,
    {
      connection: redisConnection(),
      concurrency,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[readiness-score] ✅ job ${job.id} (${job.name}) completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[readiness-score] ❌ job ${job?.id} failed:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[readiness-score] worker error:", err);
  });

  console.log(`[readiness-score] worker started — queue="${READINESS_SCORE_QUEUE_NAME}" concurrency=${concurrency}`);
  return worker;
}

/** Registers the daily sweep repeatable job. Safe to call on every boot — BullMQ dedupes repeatable jobs by (name, pattern, jobId). */
export async function registerDailySweep() {
  const { readinessScoreQueue } = await import("@/server/queue/readinessScoreQueue");
  await readinessScoreQueue.add(
    "daily-sweep",
    { organizationId: "", frameworkId: "" },
    { jobId: "daily-sweep", repeat: { pattern: "0 3 * * *" } },
  );
}
