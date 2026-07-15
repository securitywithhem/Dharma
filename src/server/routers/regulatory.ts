// Phase 9 Part 3 — regulatory change monitoring router.
//
// - listAlerts/acknowledgeAlert/dismissAlert: org-scoped, for any org member.
// - publishVersion: the admin-publishable mechanism (no external feed exists;
//   see versionPoller.ts). Gated to admins; publishes a FrameworkVersion,
//   computes the diff, and enqueues fanout. Flagged deviation: "Dharma admin"
//   in the brief maps to this repo's org `adminProcedure` (there is no
//   separate platform-superadmin role).
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, orgProcedure, adminProcedure } from "@/server/trpc";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { publishFrameworkVersion } from "@/server/lib/regulatory/versionPoller";
import { enqueueRegulatoryFanout } from "@/server/queue/regulatoryQueue";

export const regulatoryRouter = createTRPCRouter({
  /** Alerts for the caller's org, filterable by status. Unread count included. */
  listAlerts: orgProcedure
    .input(
      z
        .object({
          status: z.enum(["UNREAD", "ACKNOWLEDGED", "DISMISSED"]).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const [items, unreadCount] = await Promise.all([
        ctx.prisma.regulatoryAlert.findMany({
          where: {
            organizationId,
            ...(input.status ? { status: input.status } : {}),
            ...(input.cursor ? { id: { lt: input.cursor } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: input.limit + 1,
          include: {
            frameworkVersion: {
              select: {
                id: true,
                version: true,
                changelog: true,
                publishedAt: true,
                marketplaceItem: { select: { id: true, slug: true, name: true } },
              },
            },
          },
        }),
        ctx.prisma.regulatoryAlert.count({ where: { organizationId, status: "UNREAD" } }),
      ]);

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: data,
        nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
        hasMore,
        unreadCount,
      };
    }),

  /** Lightweight badge count for the notification bell. */
  unreadCount: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.regulatoryAlert.count({
      where: { organizationId: ctx.session.user.organizationId, status: "UNREAD" },
    });
  }),

  acknowledgeAlert: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return setAlertStatus(ctx, input.id, "ACKNOWLEDGED", "REGULATORY_ALERT_ACKNOWLEDGED");
    }),

  dismissAlert: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return setAlertStatus(ctx, input.id, "DISMISSED", "REGULATORY_ALERT_DISMISSED");
    }),

  /**
   * Admin: publish a new version of a framework MarketplaceItem and fan out
   * alerts to every org that imported it. controlsSnapshot is the full control
   * tree at this version, used for future diffs.
   */
  publishVersion: adminProcedure
    .input(
      z.object({
        marketplaceItemId: z.string().min(1),
        version: z.string().trim().min(1).max(32),
        changelog: z.string().trim().min(1).max(10_000),
        controlsSnapshot: z.any(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.prisma.marketplaceItem.findUnique({
        where: { id: input.marketplaceItemId },
        select: { id: true, type: true },
      });
      if (!item || item.type !== "FRAMEWORK") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "marketplaceItemId must reference a FRAMEWORK marketplace item.",
        });
      }

      const result = await publishFrameworkVersion(ctx.prisma, {
        marketplaceItemId: input.marketplaceItemId,
        version: input.version,
        changelog: input.changelog,
        controlsSnapshot: input.controlsSnapshot,
      }).catch((error) => {
        // Unique [marketplaceItemId, version] → friendly conflict.
        throw new TRPCError({
          code: "CONFLICT",
          message: `Version ${input.version} already exists for this framework.`,
          cause: error,
        });
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "REGULATORY_VERSION_PUBLISHED",
        entity: "FrameworkVersion",
        entityId: result.frameworkVersionId,
        changes: { marketplaceItemId: input.marketplaceItemId, version: input.version },
      });

      await enqueueRegulatoryFanout({
        frameworkVersionId: result.frameworkVersionId,
        marketplaceItemId: input.marketplaceItemId,
        version: input.version,
        diff: result.diff,
      });

      return {
        frameworkVersionId: result.frameworkVersionId,
        isFirstVersion: result.isFirstVersion,
        diff: result.diff,
      };
    }),
});

async function setAlertStatus(
  ctx: { prisma: typeof import("@/server/db").prisma; session: { user: { id: string; organizationId: string } } },
  id: string,
  status: "ACKNOWLEDGED" | "DISMISSED",
  action: string,
) {
  const organizationId = ctx.session.user.organizationId;
  const alert = await ctx.prisma.regulatoryAlert.findFirst({
    where: { id, organizationId },
  });
  if (!alert) throw new TRPCError({ code: "NOT_FOUND" });

  await ctx.prisma.regulatoryAlert.update({ where: { id: alert.id }, data: { status } });
  await emitAuditEvent(ctx.prisma, {
    organizationId,
    userId: ctx.session.user.id,
    action,
    entity: "RegulatoryAlert",
    entityId: alert.id,
    changes: { status },
  });
  return { id: alert.id, status };
}
