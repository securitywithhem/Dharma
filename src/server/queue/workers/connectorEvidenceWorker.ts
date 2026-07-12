/**
 * src/server/queue/workers/connectorEvidenceWorker.ts
 *
 * Phase 4 Part 2 — processes "connector-evidence-collection" jobs: loads an
 * EvidenceMapping + its Connector, runs the connector adapter's
 * collectEvidence(), persists the results as auto-collected Evidence rows,
 * and updates Control.status via controlStatusPolicy.
 */

import { createHash } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { ConnectorStatus, ControlStatus, EvidenceType, PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { createAuditLog } from "@/server/audit-log";
import { decryptConnectorConfig } from "@/server/lib/crypto/connectorVault";
import { getConnectorAdapter } from "@/server/connectors/registry";
import { deriveControlStatus } from "@/server/connectors/controlStatusPolicy";
import { notifyEvidenceUpdated, notifyControlFailed } from "@/server/connectors/notify";
import type { EvidenceItem } from "@/server/connectors/types";
import {
  CONNECTOR_EVIDENCE_QUEUE_NAME,
  type ConnectorEvidenceJobData,
} from "@/server/queue/connectorQueue";
import { enqueueReadinessRecompute } from "@/server/queue/readinessScoreQueue";

// ------------------------------------------------------------------
// Prisma singleton (matches src/workers/connectors/index.ts convention)
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __connectorEvidenceWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient =
  globalThis.__connectorEvidenceWorkerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__connectorEvidenceWorkerPrisma = prisma;
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

// ------------------------------------------------------------------
// Idempotency
// ------------------------------------------------------------------

// Scheduled (non-manual) runs skip if the mapping was already collected more
// recently than this window — guards against a stuck/re-delivered repeatable
// job re-running right after a previous run already completed.
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

/** Derives a stable 32-bit advisory-lock key from a mapping id. */
function advisoryLockKey(mappingId: string): number {
  const hash = createHash("sha256").update(mappingId).digest();
  return hash.readInt32BE(0);
}

// ------------------------------------------------------------------
// Job processor
// ------------------------------------------------------------------

export async function processConnectorEvidenceJob(
  job: Job<ConnectorEvidenceJobData>,
): Promise<{ status: "collected" | "skipped" | "no-adapter"; evidenceCreated: number }> {
  const { evidenceMappingId, manual } = job.data;
  const lockKey = advisoryLockKey(evidenceMappingId);

  // Non-blocking advisory lock: if another job for the same mapping is
  // already running, skip rather than double-collect. This is the primary
  // correctness guard for concurrent/duplicate enqueues (chaos/idempotency
  // testing scenario); the time-window check below is a secondary guard
  // against a stuck repeatable job re-firing shortly after a prior success.
  const [{ locked }] = await prisma.$queryRaw<[{ locked: boolean }]>`
    SELECT pg_try_advisory_lock(${lockKey}) AS locked
  `;

  if (!locked) {
    console.warn(
      `[connector-evidence] mapping ${evidenceMappingId} is already being processed — skipping`,
    );
    return { status: "skipped", evidenceCreated: 0 };
  }

  try {
    const mapping = await prisma.evidenceMapping.findUnique({
      where: { id: evidenceMappingId },
      include: {
        connector: true,
        control: { select: { id: true, status: true, frameworkId: true, framework: { select: { organizationId: true } } } },
      },
    });

    if (!mapping) {
      console.warn(`[connector-evidence] mapping ${evidenceMappingId} no longer exists — skipping`);
      return { status: "skipped", evidenceCreated: 0 };
    }

    if (
      !manual &&
      mapping.lastCollectedAt &&
      Date.now() - mapping.lastCollectedAt.getTime() < IDEMPOTENCY_WINDOW_MS
    ) {
      console.warn(
        `[connector-evidence] mapping ${evidenceMappingId} was collected ${Math.round(
          (Date.now() - mapping.lastCollectedAt.getTime()) / 1000,
        )}s ago — within idempotency window, skipping`,
      );
      return { status: "skipped", evidenceCreated: 0 };
    }

    const { connector, control } = mapping;
    const organizationId = connector.organizationId;

    let adapter;
    try {
      adapter = getConnectorAdapter(connector.type);
    } catch (err) {
      console.warn(
        `[connector-evidence] no adapter registered for connector type ${connector.type} — skipping mapping ${evidenceMappingId}`,
      );
      return { status: "no-adapter", evidenceCreated: 0 };
    }

    try {
      const config = decryptConnectorConfig(connector.config as string);
      const items = await adapter.collectEvidence(mapping.evidenceType, config);

      const createdEvidence: { id: string; item: EvidenceItem }[] = [];
      for (const item of items) {
        const evidence = await prisma.evidence.create({
          data: {
            controlId: mapping.controlId,
            organizationId,
            connectorId: connector.id,
            evidenceMappingId: mapping.id,
            fileName: item.fileName,
            filePath: `connectors/${connector.id}/${mapping.id}/${item.fileName}`,
            fileSizeBytes: 0,
            type: EvidenceType.API_RESPONSE,
            summary: item.summary,
            collectedAt: item.collectedAt,
            source: "auto",
          },
        });
        createdEvidence.push({ id: evidence.id, item });
      }

      const nextStatus = deriveControlStatus(items, control.status);
      if (nextStatus && nextStatus !== control.status) {
        await prisma.control.update({
          where: { id: control.id },
          data: { status: nextStatus },
        });

        await createAuditLog(prisma, {
          organizationId,
          userId: null,
          action: "CONTROL_STATUS_AUTO_UPDATED",
          entity: "Control",
          entityId: control.id,
          changes: { from: control.status, to: nextStatus, evidenceMappingId: mapping.id },
        });

        // deriveControlStatus only ever returns IN_PROGRESS (our stand-in for
        // "failing" — see controlStatusPolicy.ts) when at least one item
        // failed. This block only runs on an actual status transition (see
        // the `nextStatus !== control.status` guard above), so a control
        // that's already IN_PROGRESS from a prior failing run never re-fires
        // this event on subsequent failing runs.
        if (nextStatus === ControlStatus.IN_PROGRESS) {
          await notifyControlFailed(prisma, organizationId, control.id);
        }
      }

      await prisma.evidenceMapping.update({
        where: { id: mapping.id },
        data: { lastCollectedAt: new Date() },
      });

      await prisma.connector.update({
        where: { id: connector.id },
        data: { lastSyncAt: new Date(), status: ConnectorStatus.CONNECTED, lastError: null },
      });

      await createAuditLog(prisma, {
        organizationId,
        userId: null,
        action: "EVIDENCE_AUTO_COLLECTED",
        entity: "EvidenceMapping",
        entityId: mapping.id,
        changes: {
          connectorId: connector.id,
          controlId: control.id,
          evidenceType: mapping.evidenceType,
          evidenceCreated: createdEvidence.length,
          manual: !!manual,
        },
      });

      for (const { id, item } of createdEvidence) {
        await notifyEvidenceUpdated(prisma, organizationId, control.id, {
          id,
          evidenceType: item.type,
          status: item.status,
          collectedAt: item.collectedAt,
        });
      }

      // Phase 6 Part 3: debounced, async — auto-collection's own success/audit
      // trail must never be blocked by a readiness-score recompute hiccup.
      if (createdEvidence.length > 0) {
        enqueueReadinessRecompute(organizationId, control.frameworkId).catch((err) => {
          console.warn(`[readiness-score] Failed to enqueue recompute after auto-collection:`, err);
        });
      }

      return { status: "collected", evidenceCreated: createdEvidence.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await prisma.connector.update({
        where: { id: connector.id },
        data: { status: ConnectorStatus.ERROR, lastError: message },
      });

      await createAuditLog(prisma, {
        organizationId,
        userId: null,
        action: "EVIDENCE_AUTO_COLLECTION_FAILED",
        entity: "EvidenceMapping",
        entityId: mapping.id,
        changes: { connectorId: connector.id, error: message },
      });

      // Re-throw so BullMQ's retry/backoff (attempts: 3, exponential from 5s,
      // configured on the queue's defaultJobOptions) actually kicks in. The
      // connector/audit state above is already updated before this point, so
      // a retry (or eventual exhaustion) never leaves the system silently
      // unaware of the failure — "don't crash the worker process" is handled
      // by BullMQ's own job-level error boundary, not by swallowing the error.
      throw err;
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  }
}

// ------------------------------------------------------------------
// Worker factory
// ------------------------------------------------------------------

export function startConnectorEvidenceWorker() {
  const concurrency = Number(process.env.CONNECTOR_WORKER_CONCURRENCY) || 5;

  const worker = new Worker<ConnectorEvidenceJobData>(
    CONNECTOR_EVIDENCE_QUEUE_NAME,
    processConnectorEvidenceJob,
    {
      connection: redisConnection(),
      concurrency,
    },
  );

  worker.on("completed", (job, result) => {
    console.log(`[connector-evidence] ✅ job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[connector-evidence] ❌ job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[connector-evidence] worker error:", err);
  });

  console.log(
    `[connector-evidence] worker started — queue="${CONNECTOR_EVIDENCE_QUEUE_NAME}" concurrency=${concurrency}`,
  );
  return worker;
}
