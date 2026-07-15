// Phase 9 Part 3 — regulatory alert fanout queue.
//
// When an admin publishes a new FrameworkVersion, one fanout job is enqueued.
// The worker finds every org that imported the framework (via ImportedItem)
// and creates a RegulatoryAlert with the diff — off the request thread so a
// popular framework with thousands of importers doesn't block the publish.
import { Queue } from "bullmq";
import { env } from "@/env";
import type { FrameworkDiff } from "@/server/lib/regulatory/diffEngine";

export const REGULATORY_FANOUT_QUEUE_NAME = "regulatory-fanout";

export interface RegulatoryFanoutJobData {
  frameworkVersionId: string;
  marketplaceItemId: string;
  version: string;
  /** null for a framework's first version (no previous to diff against). */
  diff: FrameworkDiff | null;
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

let queue: Queue<RegulatoryFanoutJobData> | undefined;

/** Lazy so importing this from the router never opens Redis under jest. */
export function getRegulatoryFanoutQueue(): Queue<RegulatoryFanoutJobData> {
  queue ??= new Queue<RegulatoryFanoutJobData>(REGULATORY_FANOUT_QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });
  return queue;
}

export async function enqueueRegulatoryFanout(data: RegulatoryFanoutJobData): Promise<void> {
  await getRegulatoryFanoutQueue().add("fanout", data);
}
