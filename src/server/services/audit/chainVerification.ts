/**
 * GH #26 — walk an organization's hash-chained audit log and prove it intact.
 *
 * WHY THIS MODULE EXISTS RATHER THAN CALLING verifyAuditChain DIRECTLY
 * -------------------------------------------------------------------
 * `verifyAuditChain` (src/server/audit-log.ts) takes an ARRAY. The only caller
 * therefore did:
 *
 *     const logs = await prisma.auditLog.findMany({ where: { organizationId } })
 *
 * — an unbounded read of every audit entry the organization has ever written,
 * materialised in a request thread. For a demo org that is fine. For the
 * customer this feature is *for* — one with a real audit trail and an auditor
 * asking to see verification — it is a request that allocates the entire table
 * and, at a few hundred thousand entries, takes the process down rather than
 * answering the question. The hash chain is the product's strongest claim; the
 * verification of it must not be the thing that falls over.
 *
 * So verification here is CHUNKED. It streams the chain in ordered pages,
 * carrying only the previous entry's hash across a page boundary — which is all
 * the chain's definition actually requires. Memory is bounded by the page size,
 * not by the log's length, so the same code path serves both a synchronous
 * request over a small range and a background job over five years of history.
 *
 * ORDERING IS PART OF THE PROOF. The chain is only meaningful under the exact
 * order in which entries were written, so every query below carries the same
 * `[timestamp asc, createdAt asc, id asc]` ordering. `id` is the tiebreaker
 * the original code lacked: two entries written in the same millisecond have
 * equal timestamp AND equal createdAt, and an unstable sort between two pages
 * would report a chain break that does not exist — a false accusation of
 * tampering, which for this feature is a worse failure than missing a real one.
 */

import type { PrismaClient } from "@prisma/client";

import { computeAuditHash } from "@/server/audit-log";

/** Entries pulled per page. Bounded memory; not a limit on what is verified. */
export const VERIFICATION_PAGE_SIZE = 1_000;

/**
 * Above this many entries in range, a synchronous request refuses and the
 * caller is told to run the background job instead.
 *
 * 25k is roughly a second of hashing — comfortably inside a request, and far
 * enough below the point where it matters that we are not tuning on a cliff.
 */
export const SYNC_VERIFICATION_LIMIT = 25_000;

export interface VerificationRange {
  /** Inclusive lower bound on `timestamp`. Omit for "from the beginning". */
  from?: Date | null;
  /** Inclusive upper bound on `timestamp`. Omit for "up to now". */
  to?: Date | null;
}

export interface ChainVerificationResult {
  ok: boolean;
  /** The first entry at which the chain diverges. Null when ok. */
  brokenAtId: string | null;
  /** Which of the two chain invariants failed. Null when ok. */
  reason: string | null;
  /** When the broken entry claims to have been written. Null when ok. */
  brokenAtTimestamp: Date | null;
  /** Entries actually inspected. */
  totalChecked: number;
  /** The range covered, resolved to concrete instants for the report. */
  rangeFrom: Date | null;
  rangeTo: Date | null;
  checkedAt: Date;
  /**
   * True when verification started mid-chain (a `from` was supplied), so the
   * first entry's `previousHash` could not be checked against its predecessor.
   *
   * Stated rather than hidden: a range check proves the range is internally
   * consistent, NOT that nothing was deleted before it. An auditor handed a
   * partial verification must be able to see that it is partial.
   */
  partial: boolean;
}

type AuditRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown | null;
  timestamp: Date;
  createdAt: Date;
  previousHash: string | null;
  currentHash: string;
};

/** The single ordering under which the chain is defined. See header. */
const CHAIN_ORDER = [
  { timestamp: "asc" as const },
  { createdAt: "asc" as const },
  { id: "asc" as const },
];

function rangeWhere(organizationId: string, range: VerificationRange) {
  const timestamp: { gte?: Date; lte?: Date } = {};
  if (range.from) timestamp.gte = range.from;
  if (range.to) timestamp.lte = range.to;

  return {
    organizationId,
    ...(range.from || range.to ? { timestamp } : {}),
  };
}

/** How many entries a verification over this range would inspect. */
export async function countVerifiableEntries(
  prisma: PrismaClient,
  organizationId: string,
  range: VerificationRange = {},
): Promise<number> {
  return prisma.auditLog.count({ where: rangeWhere(organizationId, range) });
}

/**
 * Verify the chain over a range, streaming in pages.
 *
 * `onProgress` is called after each page with the running count, so a
 * background job can report progress on a long walk. It is optional and never
 * awaited for its result — a progress reporter must not be able to fail the
 * verification it is reporting on.
 */
export async function verifyChainRange(
  prisma: PrismaClient,
  organizationId: string,
  range: VerificationRange = {},
  onProgress?: (checked: number) => void,
): Promise<ChainVerificationResult> {
  const where = rangeWhere(organizationId, range);
  const checkedAt = new Date();

  let cursorId: string | undefined;
  let totalChecked = 0;
  // Null on the first page means "expect previousHash === null", which is the
  // genuine chain head. When a `from` bound was supplied we are starting
  // mid-chain and cannot make that assertion — see `partial` below.
  let expectedPreviousHash: string | null = null;
  let isFirstEntryOverall = true;
  const partial = Boolean(range.from);

  const fail = (
    row: AuditRow,
    reason: string,
  ): ChainVerificationResult => ({
    ok: false,
    brokenAtId: row.id,
    reason,
    brokenAtTimestamp: row.timestamp,
    totalChecked,
    rangeFrom: range.from ?? null,
    rangeTo: range.to ?? null,
    checkedAt,
    partial,
  });

  for (;;) {
    const page: AuditRow[] = await prisma.auditLog.findMany({
      where,
      orderBy: CHAIN_ORDER,
      take: VERIFICATION_PAGE_SIZE,
      // Keyset pagination, not `skip`. A verification walk that used OFFSET
      // would re-scan everything before the offset on every page — quadratic
      // over the exact logs that need this the most.
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: {
        id: true,
        organizationId: true,
        userId: true,
        action: true,
        entity: true,
        entityId: true,
        changes: true,
        timestamp: true,
        createdAt: true,
        previousHash: true,
        currentHash: true,
      },
    });

    if (page.length === 0) break;

    for (const row of page) {
      // Invariant 1 — this entry's back-pointer matches the previous entry's
      // hash. Catches deletion and reordering.
      //
      // Skipped for the first entry of a partial (range-bounded) walk: its
      // predecessor is outside the range by construction, so its previousHash
      // legitimately points at an entry we did not read.
      const skipLinkCheck = isFirstEntryOverall && partial;
      if (!skipLinkCheck && row.previousHash !== expectedPreviousHash) {
        return fail(row, "Previous hash mismatch — an entry was deleted, reordered, or inserted");
      }

      // Invariant 2 — the entry's contents still hash to its recorded hash.
      // Catches modification of an entry in place.
      const expectedHash = computeAuditHash({
        organizationId: row.organizationId,
        userId: row.userId,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        changes: row.changes,
        timestamp: row.timestamp.toISOString(),
        // Recompute against what the row ITSELF claims, not against our running
        // value. On the first entry of a partial walk those differ, and using
        // the running value would fabricate a mismatch.
        previousHash: skipLinkCheck ? row.previousHash : expectedPreviousHash,
      });

      if (expectedHash !== row.currentHash) {
        return fail(row, "Current hash mismatch — this entry's contents were altered after it was written");
      }

      expectedPreviousHash = row.currentHash;
      isFirstEntryOverall = false;
      totalChecked += 1;
    }

    cursorId = page[page.length - 1].id;
    try {
      onProgress?.(totalChecked);
    } catch {
      // A failing progress reporter must never fail the verification.
    }

    if (page.length < VERIFICATION_PAGE_SIZE) break;
  }

  return {
    ok: true,
    brokenAtId: null,
    reason: null,
    brokenAtTimestamp: null,
    totalChecked,
    rangeFrom: range.from ?? null,
    rangeTo: range.to ?? null,
    checkedAt,
    partial,
  };
}
