// Phase 9 Part 1 — endpoint-check postprocess worker.
//
// Runs the heavy heartbeat work OFF the request thread (2_TRD.md Performance):
// for each raw EndpointCheck the heartbeat route inserted, it maps the check
// to a Control (org-scoped fuzzy keyword match), and for MAPPED checks writes
// an Evidence row (source: "agent") pointing at the check result stored in
// MinIO — mirroring how Phase 4 connectors auto-collect evidence. Every check
// (mapped or not) produces an ENDPOINT_CHECK_INGESTED AuditLog entry.
//
// DESIGN-GAP: Evidence.controlId is NON-nullable in this schema, so an
// *unmapped* check cannot create an Evidence row. The task brief said to
// "create an Evidence row" and separately to "leave controlId null" — those
// conflict here. Resolution: mapped checks get Evidence; unmapped checks are
// recorded as EndpointCheck rows with controlId null and surfaced as
// "unmapped" in the UI, still fully audited. Flagged for review.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { mapCheckToControl } from "@/server/lib/endpointCheckControlMap";
import { putObject } from "@/server/minio";
import {
  ENDPOINT_CHECK_POSTPROCESS_QUEUE_NAME,
  type EndpointCheckPostprocessJobData,
} from "@/server/queue/endpointQueue";
import { logger } from "@/lib/logger";

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

export function createEndpointCheckPostprocessProcessor(prisma: PrismaClient) {
  return async (job: Job<EndpointCheckPostprocessJobData>) => {
    const { endpointId, organizationId, checkIds } = job.data;
    let mapped = 0;
    let unmapped = 0;

    for (const checkId of checkIds) {
      // Re-fetch each check ORG-SCOPED — never trust the job payload's org
      // blindly; the row must belong to the claimed org.
      const check = await prisma.endpointCheck.findFirst({
        where: { id: checkId, organizationId, endpointId },
      });
      if (!check) {
        logger.warn({ checkId, organizationId }, "postprocess: check not found / wrong org");
        continue;
      }

      const controlId = await mapCheckToControl(prisma, organizationId, check.checkType);

      if (controlId) {
        await prisma.endpointCheck.update({
          where: { id: check.id },
          data: { controlId },
        });

        // Persist the check result as a real object so the Evidence row points
        // at retrievable content (same contract as connector-collected
        // evidence), then create the Evidence row with source "agent".
        const objectName = `${organizationId}/agent-evidence/${endpointId}/${check.id}.json`;
        const body = JSON.stringify(
          { checkType: check.checkType, result: check.result, collectedAt: check.collectedAt },
          null,
          2,
        );
        let fileSizeBytes = Buffer.byteLength(body);
        try {
          await putObject(objectName, body, "application/json");
        } catch (error) {
          // If object storage is down, still create the Evidence row (summary
          // carries the result); flag size 0 so it's visibly degraded.
          logger.error({ err: error, objectName }, "postprocess: failed to store agent evidence object");
          fileSizeBytes = 0;
        }

        const resultJson = check.result as { pass?: boolean };
        await prisma.evidence.create({
          data: {
            organizationId,
            controlId,
            fileName: `${check.checkType}-${check.id}.json`,
            filePath: objectName,
            fileSizeBytes,
            type: "API_RESPONSE", // posture-check result ~ machine API response
            source: "agent", // third source value alongside "manual" | "auto"
            summary: `Endpoint ${check.checkType} check: ${resultJson.pass ? "PASS" : "FAIL"}`,
            collectedAt: check.collectedAt,
          },
        });
        mapped += 1;
      } else {
        unmapped += 1;
      }

      await emitAuditEvent(prisma, {
        organizationId,
        userId: null, // agent-originated, no human session
        action: "ENDPOINT_CHECK_INGESTED",
        entity: "EndpointCheck",
        entityId: check.id,
        changes: {
          actor: "endpoint-agent",
          endpointId,
          checkType: check.checkType,
          pass: (check.result as { pass?: boolean }).pass ?? null,
          controlId: controlId ?? null,
          mapped: controlId !== null,
        },
      });
    }

    return { processed: checkIds.length, mapped, unmapped };
  };
}

export function startEndpointCheckPostprocessWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<EndpointCheckPostprocessJobData>(
    ENDPOINT_CHECK_POSTPROCESS_QUEUE_NAME,
    createEndpointCheckPostprocessProcessor(prisma),
    {
      connection: redisConnection(),
      concurrency: Number(process.env.ENDPOINT_WORKER_CONCURRENCY ?? 5),
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, endpointId: job?.data.endpointId },
      "endpoint-check postprocess failed",
    );
  });

  return worker;
}
