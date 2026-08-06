/**
 * src/server/queue/workers/webhookWorker.ts
 *
 * Phase 4 Part 3 — processes "webhook-delivery" jobs: loads a Webhook,
 * decrypts its signing secret, builds and HMAC-signs the outgoing payload,
 * POSTs it to the configured URL, and records a WebhookDelivery row with
 * the outcome. Runs on its own queue/worker (see webhookQueue.ts) so a
 * slow or hanging external endpoint never delays evidence-collection jobs.
 */

import { Worker, type Job } from "bullmq";
import { PrismaClient, Prisma } from "@prisma/client";
import { env } from "@/env";
import { decryptWebhookSecret } from "@/server/lib/crypto/webhookVault";
import { sign, SIGNATURE_HEADER } from "@/server/webhooks/signPayload";
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  type WebhookDeliveryJobData,
} from "@/server/queue/webhookQueue";
import { safeFetch } from "@/server/lib/net/assertPublicHttpTarget";

declare global {
  // eslint-disable-next-line no-var
  var __webhookWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__webhookWorkerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__webhookWorkerPrisma = prisma;
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

const DELIVERY_TIMEOUT_MS = 5000;

export async function processWebhookDeliveryJob(
  job: Job<WebhookDeliveryJobData>,
): Promise<{ delivered: boolean; responseCode: number | null }> {
  const { webhookId, event, payload } = job.data;

  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || !webhook.isActive) {
    // Webhook was deleted or disabled between enqueue and processing — not
    // an error, just nothing left to deliver to.
    return { delivered: false, responseCode: null };
  }

  const secret = decryptWebhookSecret(webhook.secret);
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });
  const signature = sign(secret, body);

  let responseCode: number | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      // WAVE 8 (BE-4). The router enforces https:// (routers/webhook.ts),
      // which blocks the plain-HTTP metadata endpoints — but https://10.0.0.5/
      // and redirect-to-internal were both still reachable.
      const response = await safeFetch(webhook.url, {
        maxRedirects: 0,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signature,
        },
        body,
        signal: controller.signal,
      });
      responseCode = response.status;
      success = response.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Network error, timeout, or DNS failure — no response code to record.
    responseCode = null;
    success = false;
  }

  await prisma.webhookDelivery.create({
    data: {
      webhookId: webhook.id,
      event,
      payload: payload as Prisma.InputJsonValue,
      responseCode,
      success,
      attempt: job.attemptsMade + 1,
    },
  });

  if (!success) {
    // Re-throw so BullMQ's retry/backoff (attempts: 5, exponential from 10s,
    // configured on the queue's defaultJobOptions) kicks in. We intentionally
    // do NOT disable the webhook automatically on failure — the UI surfaces
    // the delivery/failure history instead, per the Part 3 spec.
    throw new Error(
      `Webhook delivery failed: ${responseCode ?? "network error"} for webhook ${webhook.id}`,
    );
  }

  return { delivered: true, responseCode };
}

export function startWebhookWorker() {
  const concurrency = env.WEBHOOK_WORKER_CONCURRENCY;

  const worker = new Worker<WebhookDeliveryJobData>(
    WEBHOOK_DELIVERY_QUEUE_NAME,
    processWebhookDeliveryJob,
    {
      connection: redisConnection(),
      concurrency,
    },
  );

  worker.on("completed", (job, result) => {
    console.log(`[webhook-delivery] ✅ job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[webhook-delivery] ❌ job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[webhook-delivery] worker error:", err);
  });

  console.log(
    `[webhook-delivery] worker started — queue="${WEBHOOK_DELIVERY_QUEUE_NAME}" concurrency=${concurrency}`,
  );
  return worker;
}
