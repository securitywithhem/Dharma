// Phase 3b — dunning queue.
//
// Two job kinds share this queue:
//   - "notify"  : enqueued by the Razorpay webhook on a failed charge.
//   - "sweep"   : repeatable daily job that acts on orgs whose grace period
//                 has elapsed. A sweep rather than a delayed per-org job so a
//                 recovered payment simply drops out of the query, instead of
//                 needing a delayed job to be found and cancelled.
import { Queue } from "bullmq";
import { env } from "@/env";

export const DUNNING_QUEUE_NAME = "dunning-notification";

/**
 * Grace period between the first failed payment and an automatic downgrade.
 *
 * 14 days is chosen to sit just past Razorpay's own retry schedule
 * (~2 weeks before it halts a subscription), so we never downgrade an org while Razorpay is
 * still trying to collect. Product-owner decision, 2026-08-03.
 */
export const DUNNING_GRACE_PERIOD_DAYS = 14;

export type DunningJobData =
  | { kind: "notify"; organizationId: string; invoiceId: string | null }
  | { kind: "sweep" };

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

let queue: Queue<DunningJobData> | null = null;

/** Lazily constructed so importing this module never opens a Redis socket. */
export function getDunningQueue(): Queue<DunningJobData> {
  if (!queue) {
    queue = new Queue<DunningJobData>(DUNNING_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1_000 },
      },
    });
  }
  return queue;
}

export async function enqueueDunningNotification(input: {
  organizationId: string;
  invoiceId: string | null;
}): Promise<void> {
  await getDunningQueue().add("notify", { kind: "notify", ...input });
}

/** Registers the repeatable daily sweep (idempotent via a fixed jobId). */
export async function registerDunningSweep(): Promise<void> {
  await getDunningQueue().add(
    "sweep",
    { kind: "sweep" },
    { jobId: "dunning-sweep", repeat: { pattern: "0 3 * * *" } },
  );
}
