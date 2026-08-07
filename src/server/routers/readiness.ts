import { PrismaClient, RecommendationStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { enqueueReadinessRecompute } from "@/server/queue/readinessScoreQueue";
import type { ScoreBreakdown } from "@/server/services/readinessScoring";

async function frameworkInOrg(prisma: PrismaClient, frameworkId: string, organizationId: string): Promise<void> {
  const framework = await prisma.framework.findFirst({
    where: { id: frameworkId, organizationId },
    select: { id: true },
  });
  if (!framework) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Framework not found for the current organization." });
  }
}

export const readinessRouter = createTRPCRouter({
  /**
   * Returns the cached ReadinessScore for a framework. If none has ever been
   * computed, enqueues one (immediate, not debounced — the caller is
   * actively waiting) and returns a `{ status: "computing" }` placeholder for
   * the UI to poll against.
   */
  getScore: orgProcedure
    .input(z.object({ frameworkId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await frameworkInOrg(ctx.prisma, input.frameworkId, organizationId);

      const score = await ctx.prisma.readinessScore.findUnique({
        where: { organizationId_frameworkId: { organizationId, frameworkId: input.frameworkId } },
      });

      if (!score) {
        await enqueueReadinessRecompute(organizationId, input.frameworkId, 0);
        return { status: "computing" as const };
      }

      return {
        status: "ready" as const,
        overallScore: score.overallScore,
        evidenceScore: score.evidenceScore,
        mappingBonus: score.mappingBonus,
        breakdown: score.breakdown as unknown as ScoreBreakdown,
        computedAt: score.computedAt,
      };
    }),

  /**
   * Manually trigger a recompute. Enqueued immediately (delay: 0) rather than
   * the standard debounce window, since the caller is explicitly asking for
   * a fresh number now; the shared jobId still prevents a flood of duplicate
   * jobs from rapid repeated clicks (client also enforces a 60s cooldown).
   */
  recompute: permissionProcedure("controls.write")
    .input(z.object({ frameworkId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await frameworkInOrg(ctx.prisma, input.frameworkId, organizationId);

      await enqueueReadinessRecompute(organizationId, input.frameworkId, 0);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "READINESS_RECOMPUTE_REQUESTED",
        entity: "Framework",
        entityId: input.frameworkId,
        changes: null,
      });

      return { status: "computing" as const };
    }),

  /** Recommendations for a framework, sorted by potentialScoreGain desc (nulls last). */
  getRecommendations: orgProcedure
    .input(
      z.object({
        frameworkId: z.string().min(1),
        statuses: z.array(z.nativeEnum(RecommendationStatus)).default([RecommendationStatus.OPEN]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await frameworkInOrg(ctx.prisma, input.frameworkId, organizationId);

      const recommendations = await ctx.prisma.recommendation.findMany({
        where: { organizationId, frameworkId: input.frameworkId, status: { in: input.statuses } },
        include: { control: { select: { id: true, title: true, code: true, domain: true } } },
      });

      return recommendations.sort((a, b) => (b.potentialScoreGain ?? -1) - (a.potentialScoreGain ?? -1));
    }),

  /** Dismiss a recommendation. Emits `RECOMMENDATION_DISMISSED`. */
  dismissRecommendation: permissionProcedure("controls.write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const existing = await ctx.prisma.recommendation.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found for the current organization." });
      }

      const updated = await ctx.prisma.recommendation.update({
        where: { id: input.id },
        data: { status: RecommendationStatus.DISMISSED, dismissedAt: new Date() },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "RECOMMENDATION_DISMISSED",
        entity: "Recommendation",
        entityId: updated.id,
        changes: { type: updated.type, controlId: updated.controlId },
      });

      return updated;
    }),

  /**
   * No time-series table exists yet (ReadinessScore holds only the current
   * value per framework) — this returns just the current score with its
   * computedAt so the UI can show "last computed at X" without fabricating a
   * trend line. True historical trending is a future enhancement (would need
   * an append-only score-history table).
   */
  getHistory: orgProcedure
    .input(z.object({ frameworkId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await frameworkInOrg(ctx.prisma, input.frameworkId, organizationId);

      const score = await ctx.prisma.readinessScore.findUnique({
        where: { organizationId_frameworkId: { organizationId, frameworkId: input.frameworkId } },
        select: { overallScore: true, computedAt: true },
      });

      return {
        current: score ? { overallScore: score.overallScore, computedAt: score.computedAt } : null,
        historicalTrendAvailable: false,
      };
    }),
});
