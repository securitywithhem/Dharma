// Phase 8 Part 2 — the SINGLE canonical audit emission function.
//
// All Phase 8 code paths call emitAuditEvent instead of createAuditLog
// directly. By default it enqueues to the audit-events BullMQ queue so the
// hash-chained (advisory-locked, serializable) write never happens on the
// request thread (TRD p95 < 200ms goal). Two escape hatches keep events
// from ever being dropped or reordered surprisingly:
//
// - AUDIT_WRITER_MODE=sync (set in envs/.env.test) writes synchronously —
//   tests assert on audit rows immediately after a mutation, and no worker
//   process runs under jest.
// - If enqueueing fails (Redis down), we fall back to a synchronous write
//   rather than losing the event: durability beats latency for audit data.
//
// Pre-Phase-8 routers still call createAuditLog directly; migrating them is
// a noted follow-up, not silently done here.
import type { PrismaClient } from "@prisma/client";
import { createAuditLog } from "@/server/audit-log";
import { getAuditEventQueue, type AuditEventJobData } from "@/server/queue/auditEventQueue";
import { logger } from "@/lib/logger";

export type AuditEventInput = {
  organizationId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown | null;
};

function shouldWriteSynchronously() {
  const mode = process.env.AUDIT_WRITER_MODE;
  if (mode === "sync") return true;
  if (mode === "async") return false; // explicit override (used by tests)
  return process.env.NODE_ENV === "test";
}

export async function emitAuditEvent(
  prisma: PrismaClient,
  input: AuditEventInput,
): Promise<void> {
  if (shouldWriteSynchronously()) {
    await createAuditLog(prisma, input);
    return;
  }

  const job: AuditEventJobData = {
    ...input,
    changes: input.changes ?? null,
    emittedAt: new Date().toISOString(),
  };

  try {
    await getAuditEventQueue().add("write", job);
  } catch (error) {
    logger.warn(
      { err: error, action: input.action, orgId: input.organizationId },
      "audit queue unavailable — falling back to synchronous audit write",
    );
    await createAuditLog(prisma, input);
  }
}
