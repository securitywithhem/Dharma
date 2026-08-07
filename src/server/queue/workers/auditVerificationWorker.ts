// GH #26 — runs chain verification off the request thread, records the result,
// produces the signed artefact, and alerts when the chain does not verify.
import { Worker, type Job } from "bullmq";
import { AuditVerificationStatus, AuditVerificationTrigger } from "@prisma/client";

import { env } from "@/env";
import { prisma } from "@/server/db";
import { opsAlert } from "@/server/lib/ops/alert";
import { verifyChainRange } from "@/server/services/audit/chainVerification";
import { buildSignedVerificationReport } from "@/server/services/audit/verificationReport";
import {
  AUDIT_VERIFICATION_QUEUE_NAME,
  type AuditVerificationJobData,
  type AuditVerificationSweepJobData,
} from "@/server/queue/auditVerificationQueue";

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

type JobData = AuditVerificationJobData | AuditVerificationSweepJobData;

function isSweep(data: JobData): data is AuditVerificationSweepJobData {
  return (data as AuditVerificationSweepJobData).sweep === true;
}

/**
 * Run one verification and record its outcome.
 *
 * Exported for tests: the interesting behaviour is what gets written for each
 * of the three outcomes, and driving that through a live BullMQ worker would
 * test the queue rather than the logic.
 */
export async function runVerification(data: AuditVerificationJobData): Promise<void> {
  const { verificationId, organizationId } = data;

  try {
    const result = await verifyChainRange(
      prisma,
      organizationId,
      {
        from: data.rangeFrom ? new Date(data.rangeFrom) : null,
        to: data.rangeTo ? new Date(data.rangeTo) : null,
      },
      // Progress is written straight to the row rather than to BullMQ's job
      // progress, because the UI polls the row — it must not need queue access
      // to render a progress bar.
      (checked) => {
        void prisma.auditChainVerification
          .update({ where: { id: verificationId }, data: { entriesChecked: checked } })
          .catch(() => {
            /* progress is cosmetic; never fail the walk over it */
          });
      },
    );

    const status = result.ok
      ? AuditVerificationStatus.PASSED
      : AuditVerificationStatus.FAILED;

    // The signed artefact is generated for a PASS and a FAIL alike. A failed
    // verification is precisely the one an auditor most needs handed to them as
    // a signed document rather than described in an email.
    let reportObjectKey: string | null = null;
    try {
      reportObjectKey = await buildSignedVerificationReport(prisma, {
        organizationId,
        verificationId,
        result,
      });
    } catch (err) {
      // Report generation failing must not lose the verification RESULT, which
      // is the thing that took the walk to produce.
      console.error("[audit-verification] report generation failed:", err);
    }

    await prisma.auditChainVerification.update({
      where: { id: verificationId },
      data: {
        status,
        entriesChecked: result.totalChecked,
        partial: result.partial,
        brokenAtId: result.brokenAtId,
        brokenAtTimestamp: result.brokenAtTimestamp,
        failureReason: result.reason,
        reportObjectKey,
        completedAt: new Date(),
      },
    });

    if (!result.ok) {
      // CRITICAL without qualification. Every other alert in this system
      // describes a service being unavailable; this one says the tamper-evident
      // audit log — the product's strongest claim — did not verify.
      await opsAlert({
        event: "audit.chain.verification_failed",
        severity: "CRITICAL",
        message:
          "Audit hash chain FAILED verification — an entry was altered, deleted, or reordered.",
        context: {
          organizationId,
          verificationId,
          brokenAtId: result.brokenAtId,
          brokenAtTimestamp: result.brokenAtTimestamp?.toISOString(),
          reason: result.reason,
          entriesChecked: result.totalChecked,
        },
      });
    }
  } catch (err) {
    // ERRORED, not FAILED. The distinction is the whole reason the enum has
    // four values: "we could not check" and "we checked and it is broken"
    // demand completely different responses, and collapsing them would either
    // cry tampering at every database blip or hide real tampering behind one.
    console.error("[audit-verification] run errored:", err);
    await prisma.auditChainVerification
      .update({
        where: { id: verificationId },
        data: {
          status: AuditVerificationStatus.ERRORED,
          failureReason: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        },
      })
      .catch(() => {
        /* nothing further we can do */
      });

    await opsAlert({
      event: "audit.chain.verification_errored",
      severity: "WARN",
      message: "Audit chain verification could not complete. This is NOT evidence of tampering.",
      context: { organizationId, verificationId },
    });
  }
}

/**
 * The nightly sweep: one verification per organization.
 *
 * Enqueued as individual jobs rather than walked inline, so one org's enormous
 * chain cannot starve every other org's check, and so a failure is scoped to
 * the tenant it belongs to.
 */
export async function runScheduledSweep(): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const { enqueueChainVerification } = await import("@/server/queue/auditVerificationQueue");

  let enqueued = 0;
  for (const org of orgs) {
    const row = await prisma.auditChainVerification.create({
      data: {
        organizationId: org.id,
        trigger: AuditVerificationTrigger.SCHEDULED,
        status: AuditVerificationStatus.RUNNING,
      },
      select: { id: true },
    });
    await enqueueChainVerification({ verificationId: row.id, organizationId: org.id });
    enqueued += 1;
  }

  return enqueued;
}

export function startAuditVerificationWorker() {
  return new Worker<JobData>(
    AUDIT_VERIFICATION_QUEUE_NAME,
    async (job: Job<JobData>) => {
      if (isSweep(job.data)) {
        const count = await runScheduledSweep();
        return { enqueued: count };
      }
      await runVerification(job.data);
      return { verificationId: job.data.verificationId };
    },
    {
      connection: redisConnection(),
      // One at a time per worker: a chain walk is IO-bound against the same
      // Postgres every other queue shares, and running several in parallel
      // during the nightly sweep would turn a background check into a
      // self-inflicted database incident.
      concurrency: 1,
    },
  );
}
