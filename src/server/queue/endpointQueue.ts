// Phase 9 Part 1 — endpoint agent queues.
//
// Two queues, following the connector/webhook queue conventions (own local
// redisConnection() built from env, matching connectorQueue.ts):
//   - endpoint-check-postprocess: per-heartbeat fan-out job. The REST route
//     only validates the token + persists raw checks, then enqueues here, so
//     the Control-mapping + Evidence creation + AuditLog write happen OFF the
//     request thread (2_TRD.md Performance: heartbeat p95 < 200ms).
//   - endpoint-stale-sweep: repeatable hourly job that marks endpoints STALE
//     when their last heartbeat is older than the staleness window.
import { Queue } from "bullmq";
import { env } from "@/env";

export const ENDPOINT_CHECK_POSTPROCESS_QUEUE_NAME = "endpoint-check-postprocess";
export const ENDPOINT_STALE_SWEEP_QUEUE_NAME = "endpoint-stale-sweep";

export interface EndpointCheckPostprocessJobData {
  endpointId: string;
  organizationId: string;
  /** IDs of the EndpointCheck rows already inserted by the heartbeat route. */
  checkIds: string[];
}

export interface EndpointStaleSweepJobData {
  /** Empty payload — the sweep scans all orgs; present for type symmetry. */
  triggeredBy?: string;
}

/** Redis connection options from env (matches connectorQueue.ts / webhookQueue.ts). */
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

let postprocessQueue: Queue<EndpointCheckPostprocessJobData> | undefined;
let staleSweepQueue: Queue<EndpointStaleSweepJobData> | undefined;

/** Lazy so importing this module (e.g. from the router) never opens Redis in tests. */
export function getEndpointCheckPostprocessQueue(): Queue<EndpointCheckPostprocessJobData> {
  postprocessQueue ??= new Queue<EndpointCheckPostprocessJobData>(
    ENDPOINT_CHECK_POSTPROCESS_QUEUE_NAME,
    {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1_000 },
      },
    },
  );
  return postprocessQueue;
}

export function getEndpointStaleSweepQueue(): Queue<EndpointStaleSweepJobData> {
  staleSweepQueue ??= new Queue<EndpointStaleSweepJobData>(
    ENDPOINT_STALE_SWEEP_QUEUE_NAME,
    {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    },
  );
  return staleSweepQueue;
}

export async function enqueueEndpointCheckPostprocess(
  data: EndpointCheckPostprocessJobData,
): Promise<void> {
  await getEndpointCheckPostprocessQueue().add("postprocess", data);
}

/** Registers the repeatable hourly stale sweep (idempotent via a fixed jobId). */
export async function registerEndpointStaleSweep(): Promise<void> {
  await getEndpointStaleSweepQueue().add(
    "stale-sweep",
    {},
    { jobId: "endpoint-stale-sweep", repeat: { pattern: "0 * * * *" } },
  );
}
