/**
 * src/server/routers/aiAdvisor.ts
 *
 * Phase 7 Part 2 — AI Advisor chat API. Thin wrapper over advisorService; all
 * orchestration (retrieval, guardrails, limits, persistence) lives there.
 *
 * STREAMING NOTE: the repo has no tRPC subscription / SSE transport wired, and
 * the spec forbids introducing a second streaming transport. `sendMessage` is
 * therefore a mutation that buffers the streamed completion server-side and
 * returns the full message + citations + usage. The token-streaming seam
 * (`onToken`, completionClient's streaming) is already in place, so Part 3 can
 * layer an SSE/subscription transport on top without changing this logic.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { runAdvisorTurn } from "@/server/ai/advisorService";
import { getMonthlyTokenBudget, getMonthlyTokensUsed } from "@/server/ai/usageLimits";

export const aiAdvisorRouter = createTRPCRouter({
  /**
   * Send a user message. Creates a session if `sessionId` is omitted. Enforces
   * per-org rate limit + monthly token budget, runs RAG retrieval + guardrails,
   * generates a grounded answer, persists the turn, and records token usage.
   */
  sendMessage: orgProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).optional(),
        message: z.string().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return runAdvisorTurn(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        sessionId: input.sessionId,
        message: input.message,
      });
    }),

  /**
   * Lightweight monthly AI token usage for the org, for the UI budget
   * indicator: `{ used, limit }` from AIUsageLog vs Plan.limits.aiTokensPerMonth.
   */
  getUsageSummary: orgProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;
    const [used, limit] = await Promise.all([
      getMonthlyTokensUsed(ctx.prisma, organizationId),
      getMonthlyTokenBudget(ctx.prisma, organizationId),
    ]);
    return { used, limit, remaining: Math.max(0, limit - used) };
  }),

  /** Full message history for one session (org + user scoped). */
  getSession: orgProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.aIAdvisorSession.findFirst({
        where: {
          id: input.sessionId,
          organizationId: ctx.session.user.organizationId,
          userId: ctx.session.user.id,
        },
        select: { id: true, messages: true, createdAt: true, updatedAt: true },
      });
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Advisor session not found." });
      }
      return session;
    }),

  /** Cursor-paginated list of the caller's sessions (newest first). */
  listSessions: orgProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(25), cursor: z.string().optional() })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.aIAdvisorSession.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          userId: ctx.session.user.id,
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: input.limit + 1,
        select: { id: true, createdAt: true, updatedAt: true },
      });
      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;
      return { items: data, nextCursor, hasMore };
    }),

  /** Delete one of the caller's sessions (org + user scoped). */
  deleteSession: orgProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const userId = ctx.session.user.id;
      const session = await ctx.prisma.aIAdvisorSession.findFirst({
        where: { id: input.sessionId, organizationId, userId },
        select: { id: true },
      });
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Advisor session not found." });
      }
      await ctx.prisma.aIAdvisorSession.delete({ where: { id: session.id } });
      await createAuditLog(ctx.prisma, {
        organizationId,
        userId,
        action: "AI_SESSION_DELETED",
        entity: "AIAdvisorSession",
        entityId: session.id,
        changes: {},
      });
      return { success: true };
    }),
});
