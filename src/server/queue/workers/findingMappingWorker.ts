/**
 * src/server/queue/workers/findingMappingWorker.ts
 *
 * WAVE 12 — runs `mapFindingToControls` off the scan-ingestion path.
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { mapFindingToControls, type MapFindingResult } from "@/server/pentest/mapFindingsToControls";
import {
  FINDING_MAPPING_QUEUE_NAME,
  type FindingMappingJobData,
} from "@/server/queue/findingMappingQueue";

declare global {
  // eslint-disable-next-line no-var
  var __findingMappingWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__findingMappingWorkerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__findingMappingWorkerPrisma = prisma;
}

/** Redis connection options from env (matches findingMappingQueue.ts). */
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

export async function processFindingMappingJob(
  job: Job<FindingMappingJobData>,
): Promise<MapFindingResult> {
  return mapFindingToControls(prisma, job.data.vulnerabilityId);
}

export function startFindingMappingWorker() {
  const worker = new Worker<FindingMappingJobData>(
    FINDING_MAPPING_QUEUE_NAME,
    processFindingMappingJob,
    { connection: redisConnection(), concurrency: 2 },
  );

  worker.on("completed", (job, result) => {
    console.log(
      `[map-findings] ✅ job ${job.id} — vulnerability ${result.vulnerabilityId}: ${result.suggested} suggestion(s)${result.skippedReason ? ` (${result.skippedReason})` : ""}`,
    );
  });

  worker.on("failed", (job, err) => {
    console.error(`[map-findings] ❌ job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[map-findings] worker error:", err);
  });

  console.log(`[map-findings] worker started — queue="${FINDING_MAPPING_QUEUE_NAME}"`);
  return worker;
}
