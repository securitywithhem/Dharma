import { MappingStrength, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { suggestMappings } from "@/server/services/controlEmbeddings";
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

/** Root ancestor id ("family") for a control — path[0] if backfilled, else the control's own id. */
function familyIdFor(path: Prisma.JsonValue | null): string | null {
  return Array.isArray(path) && path.length > 0 ? (path[0] as string) : null;
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
          select: { sourceControlId: true, targetControlId: true, sourceControl: { select: { frameworkId: true } } },
        }),
      ]);

      // controlId -> familyId, and familyId -> label, for each side.
      const familyOfA = new Map<string, string>();
      const familyLabelA = new Map<string, string>();
      for (const c of controlsA) {
        const fam = familyIdFor(c.path) ?? c.id;
        familyOfA.set(c.id, fam);
        if (fam === c.id) familyLabelA.set(fam, c.title);
      }
      // Family label = the depth-0 control's own title, if present among controlsA.
      for (const c of controlsA) {
        if (c.depth === 0) familyLabelA.set(c.id, c.title);
      }

      const familyOfB = new Map<string, string>();
      const familyLabelB = new Map<string, string>();
      for (const c of controlsB) {
        const fam = familyIdFor(c.path) ?? c.id;
        familyOfB.set(c.id, fam);
        if (fam === c.id) familyLabelB.set(fam, c.title);
      }
      for (const c of controlsB) {
        if (c.depth === 0) familyLabelB.set(c.id, c.title);
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

      for (const m of mappings) {
        const aSideId = m.sourceControl.frameworkId === input.frameworkAId ? m.sourceControlId : m.targetControlId;
        const bSideId = m.sourceControl.frameworkId === input.frameworkAId ? m.targetControlId : m.sourceControlId;
        const famA = familyOfA.get(aSideId);
        const famB = familyOfB.get(bSideId);
        if (!famA || !famB) continue; // defensive: control not in either fetched set

        if (!mappedPerFamilyA.has(famA)) mappedPerFamilyA.set(famA, new Set());
        mappedPerFamilyA.get(famA)!.add(aSideId);
        if (!mappedPerFamilyB.has(famB)) mappedPerFamilyB.set(famB, new Set());
        mappedPerFamilyB.get(famB)!.add(bSideId);

        const key = `${famA}::${famB}`;
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

      const cells = Array.from(cellMappedControls.entries()).map(([key, controlIds]) => {
        const [familyAId, familyBId] = key.split("::");
        const totalA = totalPerFamilyA.get(familyAId) ?? 0;
        const mappedCount = controlIds.size;
        return {
          familyAId,
          familyBId,
          mappingCount: mappedCount,
          coveragePct: totalA > 0 ? Math.round((mappedCount / totalA) * 1000) / 10 : 0,
        };
      });

      return {
        frameworkA: { id: frameworkA.id, name: frameworkA.name },
        frameworkB: { id: frameworkB.id, name: frameworkB.name },
        familiesA,
        familiesB,
        cells,
      };
    }),
});
