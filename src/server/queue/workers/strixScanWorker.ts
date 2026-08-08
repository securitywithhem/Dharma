/**
 * src/server/queue/workers/strixScanWorker.ts
 *
 * WAVE 12 — processes "strix-scan" jobs: runs the Strix agent for a PenTest,
 * ingests its validated findings as Vulnerability rows with proof-of-concept
 * evidence, and hands each one to the control mapper.
 *
 * Deliberately mirrors pentestScanWorker.ts's structure — same status
 * transitions, same audit actions, same "persist terminal state before you
 * rethrow" discipline — so an auditor reading the trail cannot tell which
 * engine ran except by the field that says so. Two engines writing two
 * differently-shaped trails would defeat the point of the abstraction.
 */

import { Worker, type Job } from "bullmq";
import { PenTestStatus, PrismaClient, ScanEngine, type Prisma } from "@prisma/client";
import { env } from "@/env";
import { createAuditLog } from "@/server/audit-log";
import { assertTargetVerified } from "@/server/pentest/assetVerification";
import { validateScanTarget } from "@/server/pentest/scanner";
import { embedVulnerability } from "@/server/pentest/vulnerabilityEmbedding";
import { findingMappingText } from "@/server/pentest/mapFindingsToControls";
import { parseStrixFindings } from "@/server/pentest/strix/parseStrixFindings";
import { runStrixScan, StrixUnavailableError } from "@/server/pentest/strix/runStrixScan";
import { enqueueFindingMapping } from "@/server/queue/findingMappingQueue";
import {
  STRIX_SCAN_QUEUE_NAME,
  STRIX_JOB_LOCK_MS,
  type StrixScanJobData,
} from "@/server/queue/strixScanQueue";

declare global {
  // eslint-disable-next-line no-var
  var __strixScanWorkerPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__strixScanWorkerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__strixScanWorkerPrisma = prisma;
}

/** Redis connection options from env (matches strixScanQueue.ts). */
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

export interface StrixScanJobResult {
  status: "completed" | "failed";
  penTestId: string;
  findingsIngested?: number;
  findingsSeen?: number;
}

export async function processStrixScanJob(
  job: Job<StrixScanJobData>,
): Promise<StrixScanJobResult> {
  const { penTestId } = job.data;

  if (!penTestId) {
    throw new Error("strix-scan job has no penTestId");
  }

  const penTest = await prisma.penTest.findUnique({ where: { id: penTestId } });
  if (!penTest) {
    console.warn(`[strix-scan] PenTest ${penTestId} no longer exists — skipping`);
    return { status: "failed", penTestId };
  }

  if (penTest.status === PenTestStatus.CANCELLED) {
    console.warn(`[strix-scan] PenTest ${penTestId} was cancelled — skipping`);
    return { status: "failed", penTestId };
  }

  await prisma.penTest.update({
    where: { id: penTestId },
    data: { status: PenTestStatus.RUNNING, startedAt: new Date() },
  });

  try {
    // -------------------------------------------------------------------
    // The authorization gate, re-run at dispatch. Identical in substance to
    // pentestScanWorker.ts's, and NOT optional for the new engine: the whole
    // risk of adding a second engine is that it becomes a second, weaker path
    // to launching a scan. The tRPC mutation already checked all of this;
    // checking again here is the point, because between enqueue and pickup a
    // verification can be revoked or expire, and DNS can rebind a
    // public-looking hostname onto internal address space.
    //
    // Order matters. validateScanTarget() re-resolves DNS, so it is what
    // closes the rebinding window; assertTargetVerified() re-reads the
    // VerifiedAsset row, so it is what catches revocation and expiry. The FK
    // added in 12.1 proves an authorization existed, never that it still does.
    // -------------------------------------------------------------------
    await validateScanTarget(penTest.target);
    await assertTargetVerified(prisma, penTest.organizationId, penTest.target);

    const { engineRunId, findings, runRecord, containerLogUrl } = await runStrixScan({
      target: penTest.target,
      organizationId: penTest.organizationId,
      penTestId,
      allowDestructiveTests: penTest.allowDestructiveTests,
    });

    const inputs = parseStrixFindings(findings, penTestId, penTest.organizationId);

    await prisma.penTest.update({
      where: { id: penTestId },
      data: {
        status: PenTestStatus.COMPLETED,
        completedAt: new Date(),
        engineRunId,
        containerLogUrl,
        result: {
          engine: ScanEngine.STRIX,
          engineRunId,
          runStatus: runRecord?.status ?? null,
          findingsSeen: findings.length,
          // The gap between these two numbers is meaningful and worth
          // persisting: it is how many things Strix mentioned that did not
          // carry enough proof to become a compliance artifact.
          findingsValidated: inputs.length,
          findings,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await createAuditLog(prisma, {
      organizationId: penTest.organizationId,
      userId: penTest.requestedById,
      action: "PENTEST_COMPLETED",
      entity: "PenTest",
      entityId: penTestId,
      changes: {
        engine: ScanEngine.STRIX,
        engineRunId,
        findingsCount: inputs.length,
        findingsSeen: findings.length,
      },
    });

    const ingested = await ingestFindings(penTestId, penTest.organizationId, inputs);

    return {
      status: "completed",
      penTestId,
      findingsIngested: ingested,
      findingsSeen: findings.length,
    };
  } catch (err) {
    // Two audiences, two messages. `failureReason` is what an operator reads
    // in the UI, so it must be actionable and must not leak target internals;
    // the raw error goes to the server log only. This is the WAVE 1.4
    // discipline: a dead container fails loudly, it does not vanish into Redis.
    const raw = err instanceof Error ? err.message : String(err);
    const reason =
      err instanceof StrixUnavailableError
        ? raw // already operator-facing and actionable by construction
        : humanReadableFailure(raw);

    console.error(`[strix-scan] PenTest ${penTestId} failed:`, err);

    await prisma.penTest.update({
      where: { id: penTestId },
      data: {
        status: PenTestStatus.FAILED,
        completedAt: new Date(),
        failureReason: reason,
        result: { engine: ScanEngine.STRIX, error: reason },
      },
    });

    await createAuditLog(prisma, {
      organizationId: penTest.organizationId,
      userId: penTest.requestedById,
      action: "PENTEST_FAILED",
      entity: "PenTest",
      entityId: penTestId,
      changes: { engine: ScanEngine.STRIX, reason },
    });

    // Rethrow so BullMQ records the failure. Terminal state is already
    // persisted above, so the PenTest can never be left stuck at RUNNING —
    // and with attempts: 1 (see strixScanQueue.ts) this does not re-attack.
    throw err;
  }
}

/**
 * Creates Vulnerability rows for validated findings and queues each one for
 * control mapping.
 *
 * Best-effort per finding, matching autoMapVulnerabilities.ts: the scan has
 * already completed and its raw result is already persisted, so one bad
 * finding must not fail the batch or the scan.
 */
async function ingestFindings(
  penTestId: string,
  organizationId: string,
  inputs: ReturnType<typeof parseStrixFindings>,
): Promise<number> {
  let created = 0;

  for (const input of inputs) {
    try {
      const { pocEvidence, ...scalars } = input;

      const vulnerability = await prisma.vulnerability.create({
        data: {
          ...scalars,
          pocEvidence: pocEvidence as unknown as Prisma.InputJsonValue,
        },
      });
      created += 1;

      // Embed with the same text the mapper will match on, so the vector the
      // mapping is computed from is the one that was actually indexed.
      await embedVulnerability(
        prisma,
        vulnerability.id,
        findingMappingText({
          title: vulnerability.title,
          description: vulnerability.description,
          pocEvidence,
        }),
      );

      // Mapping is queued, never inline — a slow embedding lookup must not
      // hold up ingestion of the remaining findings.
      await enqueueFindingMapping(vulnerability.id);
    } catch (err) {
      console.error(
        `[strix-scan] Failed to ingest finding "${input.rawFindingId}" for pentest ${penTestId} (org ${organizationId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return created;
}

/**
 * Turns a raw engine/system error into something an operator can act on.
 * Anything unrecognized becomes a generic message rather than raw stderr,
 * which can contain target internals or test credentials.
 */
function humanReadableFailure(raw: string): string {
  if (/could not be resolved|not a valid domain/i.test(raw)) {
    return "The scan target could not be resolved. Check the hostname and try again.";
  }
  if (/private\/reserved IP/i.test(raw)) {
    return "The scan target resolves to a private or reserved IP address and cannot be scanned.";
  }
  if (/has not verified ownership|proof expired/i.test(raw)) {
    // assertTargetVerified's messages are written for this audience already.
    return raw;
  }
  if (/exceeded its .* budget/i.test(raw)) {
    return raw;
  }
  if (/did not complete/i.test(raw)) {
    return raw;
  }
  return "The Deep Scan engine failed unexpectedly. The full engine log is stored with this scan — contact your administrator.";
}

export function startStrixScanWorker() {
  const worker = new Worker<StrixScanJobData>(STRIX_SCAN_QUEUE_NAME, processStrixScanJob, {
    connection: redisConnection(),
    // One at a time by default. An agentic scan is far heavier than a nuclei
    // run — it holds an LLM session and a sandbox container for its whole
    // duration — so it does not share PENTEST_WORKER_CONCURRENCY.
    concurrency: 1,
    // Must outlast a legitimately long run or BullMQ declares a healthy scan
    // stalled and re-queues it mid-flight. See STRIX_JOB_LOCK_MS.
    lockDuration: STRIX_JOB_LOCK_MS,
  });

  worker.on("completed", (job, result) => {
    console.log(`[strix-scan] ✅ job ${job.id} completed:`, result);
  });

  worker.on("failed", (job, err) => {
    console.error(`[strix-scan] ❌ job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[strix-scan] worker error:", err);
  });

  console.log(`[strix-scan] worker started — queue="${STRIX_SCAN_QUEUE_NAME}" concurrency=1`);
  return worker;
}
