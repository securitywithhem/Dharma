import { Queue } from "bullmq";
import { env } from "@/env";

// Deliberately a separate queue name (and thus separate Redis-side job list)
// from CONNECTOR_EVIDENCE_QUEUE_NAME — a slow or hanging external webhook
// endpoint must never delay evidence-collection jobs. Concurrency for the
// two queues' workers is also tuned independently (WEBHOOK_WORKER_CONCURRENCY
// vs CONNECTOR_WORKER_CONCURRENCY).
export const WEBHOOK_DELIVERY_QUEUE_NAME = "webhook-delivery";

export interface WebhookDeliveryJobData {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
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

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(
  WEBHOOK_DELIVERY_QUEUE_NAME,
  {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  },
);

/** Enqueues a single webhook delivery job. */
export async function enqueueWebhookDelivery(
  data: WebhookDeliveryJobData,
): Promise<string> {
  const job = await webhookDeliveryQueue.add("deliver", data);
  return job.id ?? "";
}
