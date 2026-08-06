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
      // deletedAt: null — soft-deleted policies stay in the table for the audit
      // trail (see the schema comment) but must never appear in the working list.
      where: { organizationId: ctx.session.user.organizationId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }],
    });
  }),

  // ── Lifecycle (WAVE 7) ────────────────────────────────────────────────────
  //
  // fullstack-audit-2026-08-06 §4 CRITICAL: this router exposed only list,
  // create, listTemplates, generateFromTemplate, reviewDraft and
  // getReviewStatus. There was no getById, update, publish or delete, and
  // `isPublished` was settable only at create time — so the flagship
  // "AI-drafted policy" feature produced documents that could never be opened,
  // reviewed or published, breaking User_Journeys.md flow 3 at the review step.

  /**
   * Fetch one policy. Org-scoped by the query itself, never by a
   * client-supplied organizationId.
   */
  getById: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const policy = await ctx.prisma.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
          deletedAt: null,
        },
      });

      if (!policy) {
        // Same response for "not yours" and "does not exist", so this cannot be
        // used to probe which policy ids exist in other tenants.
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });
      }

      return policy;
    }),

  /**
   * Edit a policy's title and/or content.
   *
   * Editing a PUBLISHED policy bumps `version` and returns it to draft. That is
   * deliberate and is the compliance-correct behaviour: a published policy is
   * the document the organisation attests to, so silently changing its text
   * underneath an auditor — while it still reads "Published" — would make the
   * badge a lie. Re-publishing is one click, and the audit entry records the
   * version transition.
   */
  update: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3).max(160).optional(),
        content: z.string().min(10).optional(),
        policyType: z.nativeEnum(PolicyType).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;

      if (Object.keys(changes).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No changes supplied." });
      }

      const existing = await ctx.prisma.policy.findFirst({
        where: {
          id,
          organizationId: ctx.session.user.organizationId,
          deletedAt: null,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });
      }

      // Only a content change invalidates publication. Retitling a published
      // policy is not a change to the text anyone attested to.
      const contentChanged =
        changes.content !== undefined && changes.content !== existing.content;
      const revoking = existing.isPublished && contentChanged;

      const policy = await ctx.prisma.policy.update({
        where: { id },
        data: {
          ...changes,
          ...(revoking
            ? { isPublished: false, publishedAt: null, version: existing.version + 1 }
            : {}),
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "POLICY_UPDATED",
        entity: "Policy",
        entityId: policy.id,
        changes: {
          title: policy.title,
          fields: Object.keys(changes),
          ...(revoking
            ? {
                unpublishedByEdit: true,
                versionFrom: existing.version,
                versionTo: policy.version,
              }
            : {}),
        },
      });

      return policy;
    }),

  /**
   * Publish a policy. This is the step User_Journeys.md flow 3 described and
   * the router never implemented.
   */
  publish: managerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
          deletedAt: null,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });
      }
      if (existing.isPublished) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This policy is already published.",
        });
      }

      const policy = await ctx.prisma.policy.update({
        where: { id: input.id },
        data: { isPublished: true, publishedAt: new Date() },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "POLICY_PUBLISH",
        entity: "Policy",
        entityId: policy.id,
        changes: {
          title: policy.title,
          policyType: policy.policyType,
          version: policy.version,
        },
      });

      return policy;
    }),

  /**
   * Withdraw a published policy back to draft.
   *
   * Included alongside publish so publication is not a one-way door: a policy
   * published in error otherwise has no route back except deletion, which is a
   * far heavier action and loses the draft.
   */
  unpublish: managerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
          deletedAt: null,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });
      }
      if (!existing.isPublished) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This policy is not published." });
      }

      const policy = await ctx.prisma.policy.update({
        where: { id: input.id },
        data: { isPublished: false, publishedAt: null },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "POLICY_UNPUBLISHED",
        entity: "Policy",
        entityId: policy.id,
        changes: { title: policy.title, version: policy.version },
      });

      return policy;
    }),

  /**
   * Soft-delete a policy — see the schema comment on Policy.deletedAt for why
   * this is not a hard delete.
   */
  delete: managerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
          deletedAt: null,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found." });
      }

      await ctx.prisma.policy.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "POLICY_DELETED",
        entity: "Policy",
        entityId: input.id,
        changes: {
          title: existing.title,
          policyType: existing.policyType,
          version: existing.version,
          // Recorded because "was this live when it was removed" is materially
          // different from deleting an unpublished draft.
          wasPublished: existing.isPublished,
        },
      });

      return { id: input.id };
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
