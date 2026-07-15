// Phase 8 Part 2 — async audit-event queue (TRD: "append-only AuditEvent
// table, async writer to not block requests"; this repo's audit table is
// the hash-chained AuditLog). Separate queue name so a burst of audit
// writes can never delay evidence/webhook jobs, matching the isolation
// rationale established in webhookQueue.ts.
import { Queue } from "bullmq";
import { env } from "@/env";

export const AUDIT_EVENT_QUEUE_NAME = "audit-events";

export interface AuditEventJobData {
  organizationId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown | null;
  /** Enqueue-time timestamp, recorded into changes for write-lag visibility. */
  emittedAt: string;
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

let queue: Queue<AuditEventJobData> | undefined;

/**
 * Lazily constructed: emitAuditEvent is imported by nearly every router, and
 * in sync mode (tests) the queue must never open a Redis connection at
 * module load — the same import-time-connection problem the router tests
 * already work around for other queues.
 */
export function getAuditEventQueue(): Queue<AuditEventJobData> {
  queue ??= new Queue<AuditEventJobData>(AUDIT_EVENT_QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      // The worker itself falls back gracefully; retries here cover
      // transient DB hiccups. Audit events must not be silently dropped.
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1_000 },
    },
  });
  return queue;
}
