import { MappingStrength, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { suggestMappings } from "@/server/services/controlEmbeddings";
import { strengthForConfidence } from "@/lib/mappingStrength";
import { enqueueReadinessRecompute } from "@/server/queue/readinessScoreQueue";

/** A cross-walk mapping can shift the score of either side's framework. */
function enqueueBothSides(organizationId: string, frameworkAId: string, frameworkBId: string) {
  enqueueReadinessRecompute(organizationId, frameworkAId).catch((err) =>
    console.warn(`[readiness-score] Failed to enqueue recompute for framework ${frameworkAId}:`, err),
  );
  if (frameworkBId !== frameworkAId) {
    enqueueReadinessRecompute(organizationId, frameworkBId).catch((err) =>
      console.warn(`[readiness-score] Failed to enqueue recompute for framework ${frameworkBId}:`, err),
    );
  }
}

/** Loads a control's frameworkId, scoped to the caller's org via its framework. */
async function controlFrameworkInOrg(
  prisma: Prisma.TransactionClient,
  controlId: string,
  organizationId: string,
): Promise<{ id: string; frameworkId: string; title: string } | null> {
  return prisma.control.findFirst({
    where: { id: controlId, framework: { organizationId } },
    select: { id: true, frameworkId: true, title: true },
  });
}

/**
 * The "family" a control belongs to for heatmap grouping.
 *
 * `path[0]` (its root ancestor) when the hierarchy has been materialized, else
 * the control's `domain`.
 *
 * The domain fallback is the fix for a degenerate matrix. `path` is only ever
 * written by control.createChild — the bulk seed paths (framework.create's
 * createMany, onboarding's per-domain create) leave it null, which is nearly
 * every real control. The previous fallback was the control's OWN id, so each
 * control became its own family: a 100-control framework rendered a 100-column
 * grid of 96px columns, each headed by a full control title. That is what
 * produced the unreadable "Purpose Limita…" headers — they were control titles,
 * not family names. `domain` is a required column every control already has, so
 * this groups correctly with no data migration.
 */
function familyIdFor(c: { path: Prisma.JsonValue | null; domain: string }): string {
  const path = c.path;
  return Array.isArray(path) && path.length > 0 ? (path[0] as string) : c.domain;
}

export const controlMappingRouter = createTRPCRouter({
  /**
   * Create a cross-walk mapping between two controls. Rejects self-mapping,
   * cross-org controls (either side not resolvable in the caller's org), and
   * duplicates in either direction (the unique constraint covers one
   * direction; the reverse is checked explicitly for a clean error instead of
   * a raw DB constraint violation). Emits `CONTROL_MAPPING_CREATED`.
   */
  create: managerProcedure
    .input(
      z.object({
        sourceControlId: z.string().min(1),
        targetControlId: z.string().min(1),
        mappingStrength: z.nativeEnum(MappingStrength),
        rationale: z.string().optional(),
        suggestedByAI: z.boolean().default(false),
        confidenceScore: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      if (input.sourceControlId === input.targetControlId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A control cannot be mapped to itself." });
      }

      const [source, target] = await Promise.all([
        controlFrameworkInOrg(ctx.prisma, input.sourceControlId, organizationId),
        controlFrameworkInOrg(ctx.prisma, input.targetControlId, organizationId),
      ]);
      if (!source || !target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or both controls were not found for the current organization.",
        });
      }

      const existing = await ctx.prisma.controlMapping.findFirst({
        where: {
          organizationId,
          OR: [
            { sourceControlId: input.sourceControlId, targetControlId: input.targetControlId },
            { sourceControlId: input.targetControlId, targetControlId: input.sourceControlId },
          ],
        },
        select: { id: true, status: true },
      });

      // A PROPOSED or REJECTED row is not "already mapped" — it is a machine
      // suggestion, or one a human previously turned down. In both cases an
      // explicit human create is a decision that should WIN, so promote the
      // existing row in place rather than reporting a conflict the user cannot
      // resolve (the unique constraint means they could never insert over it).
      //
      // Update-in-place, not delete-and-insert: it preserves the row id the
      // audit trail already references.
      if (existing && existing.status !== "ACCEPTED") {
        const promoted = await ctx.prisma.controlMapping.update({
          where: { id: existing.id },
          data: {
            // Re-point the pair to the direction the caller asked for, since
            // the existing row may be the reverse.
            sourceControlId: input.sourceControlId,
            targetControlId: input.targetControlId,
            mappingStrength: input.mappingStrength,
            rationale: input.rationale,
            suggestedByAI: input.suggestedByAI,
            confidenceScore: input.suggestedByAI ? input.confidenceScore : null,
            status: "ACCEPTED",
            reviewedById: ctx.session.user.id,
            reviewedAt: new Date(),
          },
        });

        await createAuditLog(ctx.prisma, {
          organizationId,
          userId: ctx.session.user.id,
          action: "CONTROL_MAPPING_ACCEPTED",
          entity: "ControlMapping",
          entityId: promoted.id,
          changes: {
            sourceControlId: input.sourceControlId,
            targetControlId: input.targetControlId,
            mappingStrength: input.mappingStrength,
            promotedFrom: existing.status,
          },
        });

        enqueueBothSides(organizationId, source.frameworkId, target.frameworkId);
        return promoted;
      }

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A mapping between these controls already exists." });
      }

      let created;
      try {
        created = await ctx.prisma.controlMapping.create({
          data: {
            organizationId,
            sourceControlId: input.sourceControlId,
            targetControlId: input.targetControlId,
            mappingStrength: input.mappingStrength,
            rationale: input.rationale,
            suggestedByAI: input.suggestedByAI,
            confidenceScore: input.suggestedByAI ? input.confidenceScore : undefined,
            createdById: ctx.session.user.id,
          },
        });
      } catch (err) {
        // The findFirst check above isn't atomic with this insert — a concurrent
        // double-submit for the same (source, target) pair can still race past it
        // and hit the DB's unique constraint. Surface the same friendly message
        // instead of a raw P2002.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new TRPCError({ code: "CONFLICT", message: "A mapping between these controls already exists." });
        }
        throw err;
      }

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MAPPING_CREATED",
        entity: "ControlMapping",
        entityId: created.id,
        changes: {
          sourceControlId: input.sourceControlId,
          targetControlId: input.targetControlId,
          mappingStrength: input.mappingStrength,
          suggestedByAI: input.suggestedByAI,
        },
      });

      enqueueBothSides(organizationId, source.frameworkId, target.frameworkId);

      return created;
    }),

  /** Update a mapping's strength/rationale. Emits `CONTROL_MAPPING_UPDATED`. */
  update: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        mappingStrength: z.nativeEnum(MappingStrength).optional(),
        rationale: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const existing = await ctx.prisma.controlMapping.findFirst({
        where: { id: input.id, organizationId },
        include: {
          sourceControl: { select: { frameworkId: true } },
          targetControl: { select: { frameworkId: true } },
        },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found for the current organization." });
      }

      const updated = await ctx.prisma.controlMapping.update({
        where: { id: input.id },
        data: {
          mappingStrength: input.mappingStrength ?? undefined,
          rationale: input.rationale ?? undefined,
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MAPPING_UPDATED",
        entity: "ControlMapping",
        entityId: updated.id,
        changes: {
          previousStrength: existing.mappingStrength,
          newStrength: updated.mappingStrength,
        },
      });

      enqueueBothSides(organizationId, existing.sourceControl.frameworkId, existing.targetControl.frameworkId);

      return updated;
    }),

  /** Delete a mapping. Emits `CONTROL_MAPPING_DELETED`. */
  delete: managerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const existing = await ctx.prisma.controlMapping.findFirst({
        where: { id: input.id, organizationId },
        include: {
          sourceControl: { select: { frameworkId: true } },
          targetControl: { select: { frameworkId: true } },
        },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found for the current organization." });
      }

      await ctx.prisma.controlMapping.delete({ where: { id: input.id } });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MAPPING_DELETED",
        entity: "ControlMapping",
        entityId: input.id,
        changes: {
          sourceControlId: existing.sourceControlId,
          targetControlId: existing.targetControlId,
        },
      });

      enqueueBothSides(organizationId, existing.sourceControl.frameworkId, existing.targetControl.frameworkId);

      return { id: input.id };
    }),

  /**
   * Mappings between two frameworks, plus each side's unmapped controls —
   * the data a side-by-side cross-walk picker needs in one call.
   */
  listForFrameworkPair: orgProcedure
    .input(z.object({ frameworkAId: z.string().min(1), frameworkBId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const [frameworkA, frameworkB] = await Promise.all([
        ctx.prisma.framework.findFirst({ where: { id: input.frameworkAId, organizationId }, select: { id: true } }),
        ctx.prisma.framework.findFirst({ where: { id: input.frameworkBId, organizationId }, select: { id: true } }),
      ]);
      if (!frameworkA || !frameworkB) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Framework not found for the current organization." });
      }

      const [controlsA, controlsB, mappings] = await Promise.all([
        ctx.prisma.control.findMany({
          where: { frameworkId: input.frameworkAId },
          select: { id: true, code: true, title: true, domain: true },
        }),
        ctx.prisma.control.findMany({
          where: { frameworkId: input.frameworkBId },
          select: { id: true, code: true, title: true, domain: true },
        }),
        ctx.prisma.controlMapping.findMany({
          where: {
            organizationId,
            OR: [
              { sourceControl: { frameworkId: input.frameworkAId }, targetControl: { frameworkId: input.frameworkBId } },
              { sourceControl: { frameworkId: input.frameworkBId }, targetControl: { frameworkId: input.frameworkAId } },
            ],
          },
          include: {
            sourceControl: { select: { id: true, code: true, title: true, frameworkId: true } },
            targetControl: { select: { id: true, code: true, title: true, frameworkId: true } },
          },
        }),
      ]);

      // Partition by review state. A PROPOSED row is a suggestion nobody has
      // agreed to yet, so it must NOT mark a control as mapped — otherwise
      // running proposeForFrameworkPair would silently empty the picker's
      // "unmapped" lists and hide exactly the controls a user still has to
      // work through.
      const accepted = mappings.filter((m) => m.status === "ACCEPTED");
      const proposals = mappings.filter((m) => m.status === "PROPOSED");

      const mappedIds = new Set<string>();
      for (const m of accepted) {
        mappedIds.add(m.sourceControlId);
        mappedIds.add(m.targetControlId);
      }

      return {
        mappings: accepted,
        proposals,
        unmappedA: controlsA.filter((c) => !mappedIds.has(c.id)),
        unmappedB: controlsB.filter((c) => !mappedIds.has(c.id)),
      };
    }),

  /**
   * AI-suggested mapping candidates for a control, ranked by embedding cosine
   * similarity against `targetFrameworkId`'s controls. Read-only — never
   * persists a ControlMapping. Org-scoping is enforced inside
   * suggestMappings() itself.
   */
  getSuggestions: orgProcedure
    .input(
      z.object({
        controlId: z.string().min(1),
        targetFrameworkId: z.string().min(1),
        topK: z.number().int().min(1).max(25).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      return suggestMappings(
        ctx.prisma,
        ctx.session.user.organizationId,
        input.controlId,
        input.targetFrameworkId,
        input.topK,
      );
    }),

  /** Pending proposals for a framework pair, highest confidence first. */
  listProposals: orgProcedure
    .input(
      z.object({
        frameworkAId: z.string().min(1),
        frameworkBId: z.string().min(1),
        minConfidence: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      return ctx.prisma.controlMapping.findMany({
        where: {
          organizationId,
          status: "PROPOSED",
          ...(input.minConfidence !== undefined ? { confidenceScore: { gte: input.minConfidence } } : {}),
          OR: [
            {
              sourceControl: { frameworkId: input.frameworkAId },
              targetControl: { frameworkId: input.frameworkBId },
            },
            {
              sourceControl: { frameworkId: input.frameworkBId },
              targetControl: { frameworkId: input.frameworkAId },
            },
          ],
        },
        select: {
          id: true,
          mappingStrength: true,
          confidenceScore: true,
          rationale: true,
          sourceControl: { select: { id: true, code: true, title: true, domain: true, frameworkId: true } },
          targetControl: { select: { id: true, code: true, title: true, domain: true, frameworkId: true } },
        },
        orderBy: [{ confidenceScore: "desc" }, { id: "asc" }],
        take: input.limit,
      });
    }),

  /**
   * Accept or reject a single proposal.
   *
   * A separate procedure rather than an extension of `update`: the precondition
   * (must currently be PROPOSED), the audit action, and the readiness side
   * effect all differ, and `update` has no callers to preserve compatibility
   * with anyway.
   */
  review: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        decision: z.enum(["ACCEPTED", "REJECTED"]),
        mappingStrength: z.nativeEnum(MappingStrength).optional(),
        rationale: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const existing = await ctx.prisma.controlMapping.findFirst({
        where: { id: input.id, organizationId },
        select: {
          id: true,
          status: true,
          sourceControl: { select: { frameworkId: true } },
          targetControl: { select: { frameworkId: true } },
        },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Mapping not found for the current organization." });
      }
      if (existing.status !== "PROPOSED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This mapping has already been reviewed (${existing.status.toLowerCase()}).`,
        });
      }

      const updated = await ctx.prisma.controlMapping.update({
        where: { id: existing.id },
        data: {
          status: input.decision,
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
          ...(input.mappingStrength ? { mappingStrength: input.mappingStrength } : {}),
          ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: input.decision === "ACCEPTED" ? "CONTROL_MAPPING_ACCEPTED" : "CONTROL_MAPPING_REJECTED",
        entity: "ControlMapping",
        entityId: updated.id,
        changes: {
          sourceControlId: updated.sourceControlId,
          targetControlId: updated.targetControlId,
          mappingStrength: updated.mappingStrength,
          confidenceScore: updated.confidenceScore,
        },
      });

      // Only an acceptance changes the score — a rejection cannot affect a
      // total the proposal was never counted in.
      if (input.decision === "ACCEPTED") {
        enqueueBothSides(organizationId, existing.sourceControl.frameworkId, existing.targetControl.frameworkId);
      }

      return updated;
    }),

  /**
   * Accept or reject many proposals at once. Without this, clearing a queue of
   * 100 proposals one dialog at a time is a rubber stamp rather than a review.
   */
  bulkReview: managerProcedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(500),
        decision: z.enum(["ACCEPTED", "REJECTED"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Scope to the org AND to PROPOSED in the same statement, so neither a
      // foreign id nor an already-reviewed one can be affected.
      const affected = await ctx.prisma.controlMapping.findMany({
        where: { id: { in: input.ids }, organizationId, status: "PROPOSED" },
        select: {
          id: true,
          sourceControl: { select: { frameworkId: true } },
          targetControl: { select: { frameworkId: true } },
        },
      });

      if (affected.length === 0) {
        return { reviewed: 0 };
      }

      const result = await ctx.prisma.controlMapping.updateMany({
        where: { id: { in: affected.map((a) => a.id) }, organizationId, status: "PROPOSED" },
        data: {
          status: input.decision,
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MAPPINGS_BULK_REVIEWED",
        entity: "ControlMapping",
        entityId: affected[0].id,
        changes: { decision: input.decision, count: result.count, ids: affected.map((a) => a.id) },
      });

      if (input.decision === "ACCEPTED") {
        // One recompute per distinct framework, not per row.
        const frameworkIds = new Set<string>();
        for (const a of affected) {
          frameworkIds.add(a.sourceControl.frameworkId);
          frameworkIds.add(a.targetControl.frameworkId);
        }
        for (const frameworkId of frameworkIds) {
          enqueueReadinessRecompute(organizationId, frameworkId).catch((err) =>
            console.warn(`[readiness-score] Failed to enqueue recompute for framework ${frameworkId}:`, err),
          );
        }
      }

      return { reviewed: result.count };
    }),

  /**
   * Bulk embedding-similarity first pass over a framework pair.
   *
   * Writes rows at status PROPOSED ONLY. Nothing here can move a compliance
   * score: readinessScoring counts ACCEPTED rows exclusively, and this
   * deliberately does not call enqueueBothSides (see below). A human accepts
   * via `review` before any proposal becomes coverage.
   *
   * Runs inline rather than as a BullMQ job. It performs no Ollama work — the
   * embeddings are precomputed by the worker and the backfill script — so each
   * candidate is a single HNSW-indexed pgvector query, and the whole pass is
   * bounded by maxControlsScanned. IF THIS EVER EMBEDS INLINE IT MUST BECOME A
   * JOB.
   */
  proposeForFrameworkPair: managerProcedure
    .input(
      z.object({
        sourceFrameworkId: z.string().min(1),
        targetFrameworkId: z.string().min(1),
        topK: z.number().int().min(1).max(5).default(3),
        minConfidence: z.number().min(0).max(1).default(0.8),
        maxProposals: z.number().int().min(1).max(500).default(100),
        maxControlsScanned: z.number().int().min(1).max(2000).default(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      if (input.sourceFrameworkId === input.targetFrameworkId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pick two different frameworks." });
      }

      const [source, target] = await Promise.all([
        ctx.prisma.framework.findFirst({
          where: { id: input.sourceFrameworkId, organizationId },
          select: { id: true },
        }),
        ctx.prisma.framework.findFirst({
          where: { id: input.targetFrameworkId, organizationId },
          select: { id: true },
        }),
      ]);
      if (!source || !target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Framework not found for the current organization." });
      }

      // Leaf controls only: readiness credits leaves, and a family-to-leaf
      // mapping is noise in the matrix. Raw SQL because `embedding` is
      // Unsupported("vector(384)") and unreachable through the Prisma client.
      const leaves = await ctx.prisma.$queryRawUnsafe<{ id: string; hasEmbedding: boolean }[]>(
        `SELECT c.id, (c.embedding IS NOT NULL) AS "hasEmbedding"
           FROM "Control" c
          WHERE c."frameworkId" = $1
            AND NOT EXISTS (SELECT 1 FROM "Control" ch WHERE ch."parentId" = c.id)
          ORDER BY c.id
          LIMIT $2`,
        input.sourceFrameworkId,
        input.maxControlsScanned,
      );

      const embedded = leaves.filter((l) => l.hasEmbedding).map((l) => l.id);
      // Surfaced to the UI so an empty result reads as "run the backfill"
      // rather than "the AI found nothing" — the single most confusing failure
      // mode this feature has.
      const unembedded = leaves.length - embedded.length;

      // Every existing pair between the two frameworks, in EITHER direction and
      // at ANY status. One normalized set handles three things at once:
      // reverse-direction duplicates, idempotency across re-runs, and REJECTED
      // tombstones (so a pair a human turned down is never re-proposed).
      const existing = await ctx.prisma.controlMapping.findMany({
        where: {
          organizationId,
          OR: [
            {
              sourceControl: { frameworkId: input.sourceFrameworkId },
              targetControl: { frameworkId: input.targetFrameworkId },
            },
            {
              sourceControl: { frameworkId: input.targetFrameworkId },
              targetControl: { frameworkId: input.sourceFrameworkId },
            },
          ],
        },
        select: { sourceControlId: true, targetControlId: true },
      });
      const pairKey = (a: string, b: string) => [a, b].sort().join("::");
      const seen = new Set(existing.map((m) => pairKey(m.sourceControlId, m.targetControlId)));

      const rows: Prisma.ControlMappingCreateManyInput[] = [];
      let skippedExisting = 0;
      let skippedBelowThreshold = 0;

      for (const controlId of embedded) {
        if (rows.length >= input.maxProposals) break;

        const suggestions = await suggestMappings(
          ctx.prisma,
          organizationId,
          controlId,
          input.targetFrameworkId,
          input.topK,
        );

        for (const s of suggestions) {
          if (rows.length >= input.maxProposals) break;
          if (s.confidenceScore < input.minConfidence) {
            skippedBelowThreshold += 1;
            continue;
          }
          const key = pairKey(controlId, s.controlId);
          if (seen.has(key)) {
            skippedExisting += 1;
            continue;
          }
          seen.add(key); // also dedupes within this run

          rows.push({
            organizationId,
            sourceControlId: controlId,
            targetControlId: s.controlId,
            mappingStrength: strengthForConfidence(s.confidenceScore),
            rationale: `Proposed by embedding similarity (cosine ${s.confidenceScore.toFixed(3)}) — pending human review.`,
            suggestedByAI: true,
            confidenceScore: s.confidenceScore,
            status: "PROPOSED",
            createdById: ctx.session.user.id,
          });
        }
      }

      let proposed = 0;
      if (rows.length > 0) {
        // skipDuplicates covers the one case the `seen` set cannot: a
        // concurrent insert of the same directional pair between the read above
        // and this write.
        const result = await ctx.prisma.controlMapping.createMany({
          data: rows,
          skipDuplicates: true,
        });
        proposed = result.count;
      }

      // ONE audit entry, not one per row: createAuditLog opens a hash-chained
      // $transaction per call, so per-row auditing would serialize 100+
      // transactions to record a single bulk action.
      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MAPPINGS_PROPOSED",
        entity: "Framework",
        entityId: input.sourceFrameworkId,
        changes: {
          targetFrameworkId: input.targetFrameworkId,
          topK: input.topK,
          minConfidence: input.minConfidence,
          scanned: embedded.length,
          proposed,
          skippedExisting,
          skippedBelowThreshold,
          unembedded,
        },
      });

      // Deliberately NOT calling enqueueBothSides. Every neighbouring procedure
      // does, so this omission would otherwise read as an oversight: PROPOSED
      // rows are excluded from readinessScoring, so there is nothing to
      // recompute, and not recomputing is part of the guarantee that a bulk
      // proposal cannot perturb the score.

      return {
        proposed,
        scanned: embedded.length,
        unembedded,
        skippedExisting,
        skippedBelowThreshold,
        truncated: proposed >= input.maxProposals,
      };
    }),

  /**
   * Overlap heatmap data for a framework pair: per top-level family (Part 1's
   * `path`/`depth` — a family is a control's root ancestor, `path[0]`, or the
   * control's own id when ungrouped/legacy), total vs. mapped control counts,
   * and a family × family cell matrix for the 2D heatmap grid. A flat
   * per-family list alone can't drive a genuine heatmap (two axes are
   * required), so this returns both per-side summaries and the cell matrix.
   */
  getOverlapMatrix: orgProcedure
    .input(z.object({ frameworkAId: z.string().min(1), frameworkBId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const [frameworkA, frameworkB] = await Promise.all([
        ctx.prisma.framework.findFirst({ where: { id: input.frameworkAId, organizationId }, select: { id: true, name: true } }),
        ctx.prisma.framework.findFirst({ where: { id: input.frameworkBId, organizationId }, select: { id: true, name: true } }),
      ]);
      if (!frameworkA || !frameworkB) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Framework not found for the current organization." });
      }

      const [controlsA, controlsB, mappings] = await Promise.all([
        ctx.prisma.control.findMany({
          where: { frameworkId: input.frameworkAId },
          select: { id: true, title: true, domain: true, path: true, depth: true },
        }),
        ctx.prisma.control.findMany({
          where: { frameworkId: input.frameworkBId },
          select: { id: true, title: true, domain: true, path: true, depth: true },
        }),
        ctx.prisma.controlMapping.findMany({
          where: {
            organizationId,
            OR: [
              { sourceControl: { frameworkId: input.frameworkAId }, targetControl: { frameworkId: input.frameworkBId } },
              { sourceControl: { frameworkId: input.frameworkBId }, targetControl: { frameworkId: input.frameworkAId } },
            ],
          },
          select: {
            sourceControlId: true,
            targetControlId: true,
            status: true,
            sourceControl: { select: { frameworkId: true } },
          },
        }),
      ]);

      // controlId -> familyId, and familyId -> label, for each side.
      //
      // A familyId is either a control id (a materialized hierarchy root) or a
      // domain string (the flat fallback). Labels are resolved in two passes:
      //   1. seed label = the familyId itself — already correct for domains;
      //   2. overwrite with the depth-0 control's title — correct for roots.
      // The old code had a third branch setting the label from the control's own
      // title whenever `fam === c.id`, which is exactly what rendered one column
      // per control. It is deliberately gone.
      const familyOfA = new Map<string, string>();
      const familyLabelA = new Map<string, string>();
      for (const c of controlsA) {
        const fam = familyIdFor(c);
        familyOfA.set(c.id, fam);
        familyLabelA.set(fam, fam);
      }
      for (const c of controlsA) {
        if (c.depth === 0 && familyLabelA.has(c.id)) familyLabelA.set(c.id, c.title);
      }

      const familyOfB = new Map<string, string>();
      const familyLabelB = new Map<string, string>();
      for (const c of controlsB) {
        const fam = familyIdFor(c);
        familyOfB.set(c.id, fam);
        familyLabelB.set(fam, fam);
      }
      for (const c of controlsB) {
        if (c.depth === 0 && familyLabelB.has(c.id)) familyLabelB.set(c.id, c.title);
      }

      const totalPerFamilyA = new Map<string, number>();
      for (const c of controlsA) {
        const fam = familyOfA.get(c.id)!;
        totalPerFamilyA.set(fam, (totalPerFamilyA.get(fam) ?? 0) + 1);
      }
      const totalPerFamilyB = new Map<string, number>();
      for (const c of controlsB) {
        const fam = familyOfB.get(c.id)!;
        totalPerFamilyB.set(fam, (totalPerFamilyB.get(fam) ?? 0) + 1);
      }

      const mappedPerFamilyA = new Map<string, Set<string>>();
      const mappedPerFamilyB = new Map<string, Set<string>>();
      // key: `${famA}::${famB}` -> distinct A-side control ids covered in that cell.
      // Tracking distinct controls (not a raw mapping-row count) keeps coveragePct
      // in [0, 100] even when one control has multiple mappings into the same
      // target family (e.g. an EQUIVALENT + a separate RELATED mapping).
      const cellMappedControls = new Map<string, Set<string>>();
      // Proposals are counted SEPARATELY and never folded into the counts above.
      // The heatmap's colour ramp encodes real, human-agreed coverage; letting
      // machine proposals tint it would recreate exactly the overstatement the
      // status field exists to prevent — just visually instead of numerically.
      const cellProposedControls = new Map<string, Set<string>>();

      for (const m of mappings) {
        if (m.status === "REJECTED") continue; // tombstone — not coverage, not a proposal

        const aSideId = m.sourceControl.frameworkId === input.frameworkAId ? m.sourceControlId : m.targetControlId;
        const bSideId = m.sourceControl.frameworkId === input.frameworkAId ? m.targetControlId : m.sourceControlId;
        const famA = familyOfA.get(aSideId);
        const famB = familyOfB.get(bSideId);
        if (!famA || !famB) continue; // defensive: control not in either fetched set

        const key = `${famA}::${famB}`;

        if (m.status === "PROPOSED") {
          if (!cellProposedControls.has(key)) cellProposedControls.set(key, new Set());
          cellProposedControls.get(key)!.add(aSideId);
          continue;
        }

        if (!mappedPerFamilyA.has(famA)) mappedPerFamilyA.set(famA, new Set());
        mappedPerFamilyA.get(famA)!.add(aSideId);
        if (!mappedPerFamilyB.has(famB)) mappedPerFamilyB.set(famB, new Set());
        mappedPerFamilyB.get(famB)!.add(bSideId);

        if (!cellMappedControls.has(key)) cellMappedControls.set(key, new Set());
        cellMappedControls.get(key)!.add(aSideId);
      }

      const familiesA = Array.from(totalPerFamilyA.entries()).map(([familyId, totalControls]) => {
        const mappedControls = mappedPerFamilyA.get(familyId)?.size ?? 0;
        return {
          familyId,
          familyName: familyLabelA.get(familyId) ?? familyId,
          totalControls,
          mappedControls,
          coveragePct: totalControls > 0 ? Math.round((mappedControls / totalControls) * 1000) / 10 : 0,
        };
      });

      const familiesB = Array.from(totalPerFamilyB.entries()).map(([familyId, totalControls]) => {
        const mappedControls = mappedPerFamilyB.get(familyId)?.size ?? 0;
        return {
          familyId,
          familyName: familyLabelB.get(familyId) ?? familyId,
          totalControls,
          mappedControls,
          coveragePct: totalControls > 0 ? Math.round((mappedControls / totalControls) * 1000) / 10 : 0,
        };
      });

      // Union of keys so a cell with only proposals still appears.
      const cellKeys = new Set([...cellMappedControls.keys(), ...cellProposedControls.keys()]);
      const cells = Array.from(cellKeys).map((key) => {
        const [familyAId, familyBId] = key.split("::");
        const totalA = totalPerFamilyA.get(familyAId) ?? 0;
        const mappedCount = cellMappedControls.get(key)?.size ?? 0;
        return {
          familyAId,
          familyBId,
          mappingCount: mappedCount,
          coveragePct: totalA > 0 ? Math.round((mappedCount / totalA) * 1000) / 10 : 0,
          /** Additive: pending proposals, deliberately excluded from coveragePct. */
          proposedCount: cellProposedControls.get(key)?.size ?? 0,
        };
      });

      return {
        frameworkA: { id: frameworkA.id, name: frameworkA.name },
        frameworkB: { id: frameworkB.id, name: frameworkB.name },
        familiesA,
        familiesB,
        cells,
        proposedTotal: Array.from(cellProposedControls.values()).reduce((n, s) => n + s.size, 0),
      };
    }),
});
