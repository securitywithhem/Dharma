/**
 * src/server/routers/audit.ts
 *
 * Audit log tRPC router.
 *
 * Procedures:
 *   list            – paginated list of audit log entries (admin only)
 *   verifyIntegrity – run the SHA-256 chain verification and return the result
 *   getById         – fetch a single log entry with its hash fields
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { verifyAuditChain } from "@/server/audit-log";
import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";

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
});
