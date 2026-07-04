/**
 * src/server/routers/policy.ts
 *
 * Phase 2 Feature 4 — Template-first policy builder router.
 *
 * Removed: triggerAIGeneration (breaking change — LLM no longer writes legal text)
 * Added:   listTemplates, generateFromTemplate, reviewDraft, getReviewStatus
 * Kept:    list, create (unchanged)
 *
 * [skills: backend-dev-guidelines]
 */

import { PolicyType } from "@prisma/client";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { reviewPolicyQueue, type ReviewPolicyJobData } from "@/workers/policy";
import { Job } from "bullmq";
import { TRPCError } from "@trpc/server";
import { env } from "@/env";

// ------------------------------------------------------------------
// Handlebars (dynamic import to keep server bundle lean)
// ------------------------------------------------------------------

async function renderTemplate(templateBody: string, variables: Record<string, string>): Promise<string> {
  const Handlebars = (await import("handlebars")).default;
  const compiled = Handlebars.compile(templateBody, { strict: false, noEscape: false });
  return compiled(variables);
}

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------

export const policyRouter = createTRPCRouter({
  /**
   * List all policies for the org.
   */
  list: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.policy.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: [{ updatedAt: "desc" }],
    });
  }),

  /**
   * Create or update a policy (manual save — does not call LLM).
   */
  create: managerProcedure
    .input(
      z.object({
        title: z.string().min(3).max(160),
        content: z.string().min(10),
        policyType: z.nativeEnum(PolicyType),
        isPublished: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await ctx.prisma.policy.create({
        data: {
          ...input,
          organizationId: ctx.session.user.organizationId,
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: input.isPublished ? "POLICY_PUBLISH" : "POLICY_CREATED",
        entity: "Policy",
        entityId: policy.id,
        changes: { title: input.title, policyType: input.policyType },
      });

      return policy;
    }),

  // ── Template-First Builder (Phase 2 Feature 4) ────────────────────────────

  /**
   * List active policy templates, optionally filtered by type.
   */
  listTemplates: orgProcedure
    .input(z.object({ policyType: z.nativeEnum(PolicyType).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.policyTemplate.findMany({
        where: {
          isActive: true,
          ...(input.policyType ? { policyType: input.policyType } : {}),
        },
        select: {
          id: true,
          policyType: true,
          name: true,
          version: true,
          variables: true,
          // bodyTemplate intentionally omitted — fetched per-render
        },
        orderBy: [{ policyType: "asc" }, { name: "asc" }],
      });
    }),

  /**
   * Render a policy template with the supplied variable values.
   * No LLM call — pure Handlebars substitution.
   * Returns rendered markdown immediately.
   */
  generateFromTemplate: managerProcedure
    .input(
      z.object({
        templateId: z.string().min(1),
        variables: z.record(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const template = await ctx.prisma.policyTemplate.findFirst({
        where: { id: input.templateId, isActive: true },
      });

      if (!template) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found or inactive." });
      }

      // Validate required variables
      const varDefs = template.variables as Array<{
        key: string;
        label: string;
        required: boolean;
      }>;

      const missing = varDefs
        .filter((v) => v.required && !input.variables[v.key]?.trim())
        .map((v) => v.label);

      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing required variable(s): ${missing.join(", ")}`,
        });
      }

      const rendered = await renderTemplate(template.bodyTemplate, input.variables);

      return {
        content: rendered,
        templateName: template.name,
        policyType: template.policyType,
      };
    }),

  /**
   * Submit a policy draft for AI review (audit-only — no rewrites).
   * Enqueues a review-policy-draft BullMQ job.
   */
  reviewDraft: managerProcedure
    .input(
      z.object({
        policyContent: z.string().min(50).max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const job = await reviewPolicyQueue.add("review-draft", {
        policyContent: input.policyContent,
        organizationId: ctx.session.user.organizationId,
      } satisfies ReviewPolicyJobData);

      return { jobId: job.id };
    }),

  /**
   * Poll the status of a policy review job.
   */
  getReviewStatus: managerProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const job = await Job.fromId(reviewPolicyQueue, input.jobId);

      if (!job) return { status: "not_found" as const };

      const state = await job.getState();

      if (state === "completed") {
        return { status: "completed" as const, findings: job.returnvalue };
      }
      if (state === "failed") {
        return { status: "failed" as const, error: job.failedReason };
      }

      return { status: "active" as const };
    }),
});
