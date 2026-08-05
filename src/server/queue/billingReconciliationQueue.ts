// Phase 3b — billing reconciliation queue.
//
// Safety net for the webhook path. Webhooks get missed: a deploy during
// delivery, an exhausted retry budget, a signing-secret rotation. Without a
// reconciler those orgs sit on a stale plan indefinitely — either paying for
// entitlements they cannot use, or using entitlements they stopped paying for.
// Runs daily and treats Razorpay as the source of truth.
import { Queue } from "bullmq";
import { env } from "@/env";

export const BILLING_RECONCILIATION_QUEUE_NAME = "billing-reconciliation";

export type BillingReconciliationJobData = Record<string, never>;

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

let queue: Queue<BillingReconciliationJobData> | null = null;

export function getBillingReconciliationQueue(): Queue<BillingReconciliationJobData> {
  if (!queue) {
    queue = new Queue<BillingReconciliationJobData>(BILLING_RECONCILIATION_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return queue;
}

/** Registers the repeatable daily reconciliation (idempotent via a fixed jobId). */
export async function registerBillingReconciliation(): Promise<void> {
  await getBillingReconciliationQueue().add(
    "reconcile",
    {},
    { jobId: "billing-reconciliation", repeat: { pattern: "0 4 * * *" } },
  );
}
