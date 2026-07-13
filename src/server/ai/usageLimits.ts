/**
 * src/server/ai/usageLimits.ts
 *
 * Phase 7 Part 2 — per-org rate limiting and token-cost tracking for the AI
 * Advisor (2_TRD.md "Rate limiting per org using token bucket";
 * 6_IMPLEMENTATION_PLAN.md Phase 7 task 6).
 *
 * Two independent limits, both enforced before a completion runs:
 *   1. Requests/minute — reuses the existing in-process limiter
 *      (src/server/lib/rateLimit.ts), keyed per org.
 *   2. Monthly token budget — sums AIUsageLog for the org over the current
 *      calendar month and compares against the org Plan's
 *      `limits.aiTokensPerMonth` (falls back to a conservative default; never
 *      hard-coded per-org).
 *
 * After each completion, recordUsage writes an AIUsageLog row with the actual
 * usage returned by completionClient.
 */

import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { checkRateLimit } from "@/server/lib/rateLimit";

/** Chat requests allowed per org per minute. */
export const AI_REQUESTS_PER_MINUTE = 10;

/** Fallback monthly token cap when the org's Plan doesn't specify one. */
export const DEFAULT_AI_TOKENS_PER_MONTH = 50_000;

/** Stable marker in the budget-exceeded error message so the UI can branch. */
export const AI_BUDGET_EXCEEDED = "AI_BUDGET_EXCEEDED";

/** Throws TOO_MANY_REQUESTS if the org exceeds its per-minute request rate. */
export function enforceAiRateLimit(organizationId: string): void {
  checkRateLimit(`${organizationId}:aiAdvisor.sendMessage`, AI_REQUESTS_PER_MINUTE, 60_000);
}

/** The org's monthly token budget, read from its Plan (or the default). */
export async function getMonthlyTokenBudget(prisma: PrismaClient, organizationId: string): Promise<number> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: { select: { limits: true } } },
  });
  const limits = org?.plan?.limits as Record<string, unknown> | null | undefined;
  const cap = limits?.aiTokensPerMonth;
  return typeof cap === "number" && cap > 0 ? cap : DEFAULT_AI_TOKENS_PER_MONTH;
}

/** Total tokens (prompt + completion) the org has used this calendar month. */
export async function getMonthlyTokensUsed(prisma: PrismaClient, organizationId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.aIUsageLog.aggregate({
    where: { organizationId, createdAt: { gte: monthStart } },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return (agg._sum.promptTokens ?? 0) + (agg._sum.completionTokens ?? 0);
}

/**
 * Throws TOO_MANY_REQUESTS (message tagged AI_BUDGET_EXCEEDED) if the org has
 * already met or exceeded its monthly token budget. Checked before generating,
 * so a request that would start over budget is rejected up front.
 */
export async function enforceMonthlyBudget(prisma: PrismaClient, organizationId: string): Promise<void> {
  const [budget, used] = await Promise.all([
    getMonthlyTokenBudget(prisma, organizationId),
    getMonthlyTokensUsed(prisma, organizationId),
  ]);
  if (used >= budget) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `${AI_BUDGET_EXCEEDED}: monthly AI token budget of ${budget.toLocaleString()} reached. Resets at the start of next month or upgrade your plan.`,
    });
  }
}

/** Persist actual token usage for one completed chat turn. */
export async function recordUsage(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    userId: string;
    sessionId?: string | null;
    promptTokens: number;
    completionTokens: number;
  },
): Promise<void> {
  await prisma.aIUsageLog.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      sessionId: params.sessionId ?? null,
      promptTokens: Math.max(0, Math.round(params.promptTokens)),
      completionTokens: Math.max(0, Math.round(params.completionTokens)),
    },
  });
}
