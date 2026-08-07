import { Queue } from "bullmq";
import { env } from "@/env";

export const CONTROL_EMBEDDING_QUEUE_NAME = "embed-control";

export interface ControlEmbeddingJobData {
  controlId: string;
}

/** Redis connection options from env (matches src/server/queue/connectorQueue.ts). */
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

export const controlEmbeddingQueue = new Queue<ControlEmbeddingJobData>(CONTROL_EMBEDDING_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

/**
 * Enqueues a control for (re-)embedding — fire-and-forget from the caller's
 * perspective. Triggered on control text create/update only (title,
 * description, code); `move`/`reorder`/`updateStatus` don't change the
 * embedded text and must not re-trigger this job.
 */
export async function enqueueControlEmbedding(controlId: string): Promise<void> {
  await controlEmbeddingQueue.add("embed-control", { controlId });
}

/**
 * Bulk variant for the seed paths (framework.create, onboarding), which mint
 * ~20-100 controls at once.
 *
 * `addBulk` so a framework seed is one Redis round-trip rather than one per
 * control. The lower priority matters: BullMQ serves lower numbers first, and
 * the default for `enqueueControlEmbedding` above is 0. Without this, seeding a
 * 100-control framework would put 100 jobs ahead of the single-control embed a
 * user triggers by editing a control in the UI, and that interactive edit would
 * wait behind minutes of batch work.
 */
export async function enqueueControlEmbeddings(controlIds: string[]): Promise<void> {
  if (controlIds.length === 0) return;
  await controlEmbeddingQueue.addBulk(
    controlIds.map((controlId) => ({
      name: "embed-control",
      data: { controlId },
      opts: { priority: 10 },
    })),
  );
}
