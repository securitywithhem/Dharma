// GH #26 — background audit-chain verification.
//
// Verification is exactly the kind of work this codebase's convention says
// belongs on BullMQ: unbounded in duration, proportional to a customer's data
// volume, and worthless if it times out halfway. It is also the work most
// likely to be triggered while an auditor is watching, so "the page spun and
// then errored" is the failure mode to design away.
//
// Also registers the SCHEDULED sweep. That is the half that turns this from a
// reporting feature into a detective control: verification that only runs when
// somebody opens a page detects tampering whenever they next happen to look,
// which is not a detection time you can put in a SOC 2 narrative.
import { Queue } from "bullmq";
import { env } from "@/env";

export const AUDIT_VERIFICATION_QUEUE_NAME = "verify-audit-chain";

/** Repeatable sweep across every organization. */
const SCHEDULED_SWEEP_JOB_ID = "scheduled-chain-sweep";

export interface AuditVerificationJobData {
  /** The AuditChainVerification row this job fulfils. */
  verificationId: string;
  organizationId: string;
  rangeFrom?: string | null;
  rangeTo?: string | null;
}

/** Marker payload for the org-wide repeatable sweep (no verification row yet). */
export interface AuditVerificationSweepJobData {
  sweep: true;
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

export const auditVerificationQueue = new Queue<
  AuditVerificationJobData | AuditVerificationSweepJobData
>(AUDIT_VERIFICATION_QUEUE_NAME, {
  connection: redisConnection(),
  defaultJobOptions: {
    // ONE attempt, unlike every other queue in this repo. Deliberate: a
    // verification that reports FAILED has not errored — it has succeeded at
    // its job and found tampering. Retrying is meaningless for that outcome,
    // and for a genuine infrastructure error a retry would re-walk the entire
    // chain, which is the most expensive possible thing to do repeatedly. The
    // worker records ERRORED and an operator re-runs deliberately.
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export async function enqueueChainVerification(
  data: AuditVerificationJobData,
): Promise<void> {
  await auditVerificationQueue.add("verify", data, {
    // Keyed on the verification row, so a double-click cannot start two walks
    // over the same range writing to the same record.
    jobId: data.verificationId,
  });
}

/**
 * Register the scheduled sweep. Idempotent — BullMQ dedupes on the repeat key,
 * so worker restarts do not accumulate duplicate schedules.
 *
 * Daily at 03:00. Nightly rather than hourly because the chain is append-only
 * and a full walk is the expensive operation here; nightly bounds undetected
 * tampering to 24 hours, which is the figure to state in the control narrative.
 */
export async function registerScheduledChainVerification(): Promise<void> {
  await auditVerificationQueue.add(
    "sweep",
    { sweep: true },
    {
      jobId: SCHEDULED_SWEEP_JOB_ID,
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: { count: 30 },
    },
  );
}
