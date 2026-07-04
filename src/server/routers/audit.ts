/**
 * src/server/routers/audit.ts
 *
 * Audit log tRPC router.
 *
 * Procedures:
 *   list                  – paginated list of audit log entries (admin only)
 *   verifyIntegrity       – run the SHA-256 chain verification and return the result
 *   getById               – fetch a single log entry with its hash fields
 *   listActions           – distinct action names for filter dropdown
 *   getAnchors            – list WORM anchor records for the org (Phase 2)
 *   verifyAgainstAnchor   – round-trip verify against WORM storage (Phase 2)
 *   triggerManualAnchor   – enqueue an immediate anchor job (Phase 2, admin)
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { verifyAuditChain } from "@/server/audit-log";
import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";
import { anchorQueue, type AnchorJobData } from "@/workers/anchor";
import { verifyAgainstStoredAnchor } from "@/lib/services/chainAnchor";
import { createAuditLog } from "@/server/audit-log";


export const auditRouter = createTRPCRouter({
  /**
   * Paginated audit log for the current organisation (admin-only).
   *
   * Returns logs ordered newest-first with user info attached.
   * Uses cursor-based pagination to avoid heavy OFFSET scans on large tables.
   */
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().optional(), // cuid of the last seen entry
        action: z.string().optional(), // filter by action name
        entity: z.string().optional(), // filter by entity type
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.auditLog.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          ...(input.action ? { action: input.action } : {}),
          ...(input.entity ? { entity: input.entity } : {}),
          ...(input.cursor
            ? {
                // cursor is a cuid; sort by timestamp desc so cursor points to an older entry
                id: { lt: input.cursor },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
        take: input.limit + 1,
      });

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      return { items: data, nextCursor, hasMore };
    }),

  /**
   * Verify the SHA-256 hash chain for the current organisation.
   *
   * Loads all logs in ascending order and re-computes each hash.
   * Returns:
   *   ok          – true if the chain is intact
   *   brokenAtId  – id of the first broken entry (null if ok)
   *   reason      – human-readable explanation (null if ok)
   *   checkedAt   – server timestamp of the verification run
   *   totalChecked – number of log entries inspected
   */
  verifyIntegrity: orgProcedure.query(async ({ ctx }) => {
    const logs = await ctx.prisma.auditLog.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });

    const result = verifyAuditChain(logs);

    return {
      ...result,
      checkedAt: new Date(),
      totalChecked: logs.length,
    };
  }),

  /**
   * Fetch a single audit log entry by id (admin-only).
   * Includes the full currentHash and previousHash for manual inspection.
   */
  getById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const log = await ctx.prisma.auditLog.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      if (!log) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Audit log entry not found.",
        });
      }

      return log;
    }),

  /**
   * Return the list of distinct action names seen in this org's audit log.
   * Useful for building filter dropdowns in the UI.
   */
  listActions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.auditLog.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    });

    return rows.map((r) => r.action);
  }),

  // ────────────────────────────────────────────────────────────────
  // Phase 2 Feature 3 — WORM Anchor procedures
  // ────────────────────────────────────────────────────────────────

  /**
   * List ChainAnchor records for the current organisation, newest first.
   */
  getAnchors: adminProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(50).default(20) }).default({}),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.chainAnchor.findMany({
        where: { organizationId: ctx.session.user.organizationId },
        orderBy: { anchoredAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          rootHash: true,
          recordCount: true,
          fromLogId: true,
          toLogId: true,
          anchoredAt: true,
          storageKey: true,
          publicProof: true,
        },
      });
    }),

  /**
   * Round-trip verify a specific anchor against WORM storage.
   * Returns whether the current chain matches the stored manifest.
   */
  verifyAgainstAnchor: adminProcedure
    .input(z.object({ anchorId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      try {
        const result = await verifyAgainstStoredAnchor(
          ctx.prisma,
          input.anchorId,
          organizationId,
        );
        return result;
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),

  /**
   * Enqueue an immediate single-org anchor job.
   * Useful for the "Anchor Now" admin button.
   */
  triggerManualAnchor: adminProcedure.mutation(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;
    const job = await anchorQueue.add(
      "manual-anchor",
      { organizationId } satisfies AnchorJobData,
      { priority: 1 }, // run before scheduled jobs
    );

    await createAuditLog(ctx.prisma, {
      organizationId,
      userId: ctx.session.user.id,
      action: "AUDIT_ANCHOR_TRIGGERED",
      entity: "ChainAnchor",
      entityId: job.id ?? "unknown",
      changes: { triggeredManually: true },
    });

    return { jobId: job.id };
  }),
});
