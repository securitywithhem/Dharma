import { ControlStatus, Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { enqueueControlEmbedding } from "@/server/queue/controlEmbeddingQueue";

/**
 * Phase 6 — control hierarchy helpers.
 *
 * Control has no direct `organizationId`; tenancy is enforced through the parent
 * Framework. These helpers load a control/framework already scoped to the caller's
 * org so cross-tenant IDs surface as NOT_FOUND rather than leaking data.
 */
type ScopedControl = {
  id: string;
  frameworkId: string;
  parentId: string | null;
  domain: string;
  title: string;
  depth: number;
  path: Prisma.JsonValue;
};

async function loadControlInOrg(
  prisma: PrismaClient,
  controlId: string,
  organizationId: string,
): Promise<ScopedControl> {
  const control = await prisma.control.findFirst({
    where: { id: controlId, framework: { organizationId } },
    select: {
      id: true,
      frameworkId: true,
      parentId: true,
      domain: true,
      title: true,
      depth: true,
      path: true,
    },
  });
  if (!control) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Control not found for the current organization.",
    });
  }
  return control;
}

/** The `path` column is a JSON array of ancestor IDs (root-first, incl. self). */
function pathToIds(path: Prisma.JsonValue): string[] {
  return Array.isArray(path) ? (path as string[]) : [];
}

export const controlRouter = createTRPCRouter({
  /**
   * Get a single control by ID with related framework and evidence.
   */
  getById: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const control = await ctx.prisma.control.findFirst({
        where: {
          id: input.id,
          framework: {
            organizationId: ctx.session.user.organizationId,
          },
        },
        include: {
          framework: true,
          evidence: {
            select: {
              id: true,
              fileName: true,
              type: true,
              summary: true,
              collectedAt: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }],
          },
        },
      });

      if (!control) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Control not found for the current organization.",
        });
      }

      return {
        id: control.id,
        frameworkId: control.frameworkId,
        framework: control.framework,
        domain: control.domain,
        title: control.title,
        description: control.description,
        guidance: control.guidance ?? undefined,
        status: control.status,
        createdAt: control.createdAt,
        updatedAt: control.updatedAt,
        evidence: control.evidence.map((ev) => ({
          id: ev.id,
          fileName: ev.fileName,
          type: ev.type,
          summary: ev.summary ?? undefined,
          uploadedAt: ev.createdAt,
        })),
      };
    }),

  /**
   * List controls for a given framework, optionally filtered by domain.
   * Returns controls sorted by domain then title, with evidence counts.
   */
  listByFramework: orgProcedure
    .input(
      z.object({
        frameworkId: z.string().min(1),
        domain: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify the framework belongs to the org
      const framework = await ctx.prisma.framework.findFirst({
        where: {
          id: input.frameworkId,
          organizationId: ctx.session.user.organizationId,
        },
        select: { id: true },
      });

      if (!framework) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      const controls = await ctx.prisma.control.findMany({
        where: {
          frameworkId: input.frameworkId,
          ...(input.domain ? { domain: input.domain } : {}),
        },
        include: {
          _count: { select: { evidence: true } },
        },
        orderBy: [{ domain: "asc" }, { title: "asc" }],
      });

      return controls.map((c) => ({
        id: c.id,
        domain: c.domain,
        title: c.title,
        description: c.description,
        status: c.status,
        guidance: c.guidance ?? undefined,
        evidenceCount: c._count.evidence,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
    }),

  /**
   * Update a control's compliance status.
   * Creates an audit log entry on every change.
   */
  updateStatus: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        status: z.nativeEnum(ControlStatus),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.control.findFirst({
        where: {
          id: input.id,
          framework: {
            organizationId: ctx.session.user.organizationId,
          },
        },
        select: {
          id: true,
          status: true,
          frameworkId: true,
          framework: { select: { organizationId: true } },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Control not found for the current organization.",
        });
      }

      const previousStatus = existing.status;

      const updated = await ctx.prisma.control.update({
        where: { id: input.id },
        data: { status: input.status },
        include: {
          framework: { select: { id: true, name: true } },
          _count: { select: { evidence: true } },
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_STATUS_UPDATED",
        entity: "Control",
        entityId: updated.id,
        changes: {
          previousStatus,
          newStatus: input.status,
          frameworkName: updated.framework.name,
        },
      });

      return {
        id: updated.id,
        frameworkId: updated.frameworkId,
        domain: updated.domain,
        title: updated.title,
        description: updated.description,
        guidance: updated.guidance ?? undefined,
        status: updated.status,
        evidenceCount: updated._count.evidence,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }),

  /**
   * Create a control node in the hierarchy.
   *
   * With `parentId` it creates a child that inherits the parent's `domain` and sits
   * one level deeper; with `parentId: null` it creates a new root control (a `domain`
   * must then be supplied). Path/depth/sortOrder are computed server-side and the
   * whole thing is transaction-wrapped. Emits `CONTROL_CREATED`.
   */
  createChild: managerProcedure
    .input(
      z.object({
        frameworkId: z.string().min(1),
        parentId: z.string().min(1).nullable(),
        title: z.string().min(1).max(300),
        description: z.string().min(1),
        code: z.string().max(120).optional(),
        guidance: z.string().optional(),
        domain: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Framework must belong to the caller's org.
      const framework = await ctx.prisma.framework.findFirst({
        where: { id: input.frameworkId, organizationId },
        select: { id: true, name: true },
      });
      if (!framework) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      let parentPath: string[] = [];
      let depth = 0;
      let domain = input.domain;

      if (input.parentId) {
        const parent = await loadControlInOrg(ctx.prisma, input.parentId, organizationId);
        if (parent.frameworkId !== input.frameworkId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Parent control belongs to a different framework.",
          });
        }
        parentPath = pathToIds(parent.path);
        depth = parent.depth + 1;
        domain = parent.domain; // children inherit the family/domain of their parent
      }

      if (!domain) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A domain is required when creating a root-level control.",
        });
      }

      // Create then patch `path` with the generated id (path includes self).
      const created = await ctx.prisma.$transaction(async (tx) => {
        // Next sort position among siblings — read inside the txn so concurrent
        // adds under the same parent can't collide on the same sortOrder.
        const lastSibling = await tx.control.findFirst({
          where: { frameworkId: input.frameworkId, parentId: input.parentId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const sortOrder = (lastSibling?.sortOrder ?? -1) + 1;

        const row = await tx.control.create({
          data: {
            frameworkId: input.frameworkId,
            parentId: input.parentId,
            domain,
            title: input.title,
            description: input.description,
            code: input.code,
            guidance: input.guidance,
            depth,
            sortOrder,
            path: [], // placeholder; patched below now that we have the id
          },
          select: { id: true },
        });
        return tx.control.update({
          where: { id: row.id },
          data: { path: [...parentPath, row.id] },
          select: {
            id: true,
            frameworkId: true,
            parentId: true,
            domain: true,
            title: true,
            description: true,
            code: true,
            guidance: true,
            status: true,
            depth: true,
            sortOrder: true,
            path: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_CREATED",
        entity: "Control",
        entityId: created.id,
        changes: {
          frameworkName: framework.name,
          parentId: input.parentId,
          depth: created.depth,
          title: created.title,
        },
      });

      // Phase 6 Part 2: async, non-blocking — embedding failure must never
      // affect control creation. Only triggered here (text create); `move`
      // and `reorder` don't change the embedded title/description/code text,
      // and there is currently no separate "update control text" mutation.
      enqueueControlEmbedding(created.id).catch((err) => {
        console.warn(`[control-embedding] Failed to enqueue embedding job for ${created.id}:`, err);
      });

      return {
        ...created,
        code: created.code ?? undefined,
        guidance: created.guidance ?? undefined,
        path: pathToIds(created.path),
      };
    }),

  /**
   * Re-parent a control (and its whole subtree) under `newParentId`, or to the root
   * when `newParentId` is null. Recomputes path/depth for the moved node and every
   * descendant via a single recursive SQL statement. Rejects cycles (a control cannot
   * be moved beneath itself or one of its own descendants). Emits `CONTROL_MOVED`.
   */
  move: managerProcedure
    .input(
      z.object({
        controlId: z.string().min(1),
        newParentId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const control = await loadControlInOrg(ctx.prisma, input.controlId, organizationId);

      let newPathPrefix: string[] = [];
      let newDepth = 0;

      if (input.newParentId) {
        if (input.newParentId === input.controlId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A control cannot be moved under itself.",
          });
        }
        const newParent = await loadControlInOrg(ctx.prisma, input.newParentId, organizationId);
        if (newParent.frameworkId !== control.frameworkId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot move a control into a different framework.",
          });
        }
        // Cycle guard: if the control is an ancestor of the target parent, the target's
        // materialized path contains the control's id — reject.
        if (pathToIds(newParent.path).includes(input.controlId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot move a control beneath one of its own descendants.",
          });
        }
        newPathPrefix = pathToIds(newParent.path);
        newDepth = newParent.depth + 1;
      }

      const prefixJson = JSON.stringify(newPathPrefix);

      await ctx.prisma.$transaction(async (tx) => {
        // Position at the end of the destination sibling list.
        const lastSibling = await tx.control.findFirst({
          where: { frameworkId: control.frameworkId, parentId: input.newParentId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const sortOrder = (lastSibling?.sortOrder ?? -1) + 1;

        await tx.control.update({
          where: { id: input.controlId },
          data: { parentId: input.newParentId, sortOrder },
        });

        // Recompute path/depth for the moved node and all descendants. The recursion
        // walks the (unchanged) parentId links; the base row seeds the new prefix.
        await tx.$executeRaw`
          WITH RECURSIVE subtree AS (
            SELECT
              id,
              COALESCE(
                (SELECT array_agg(value ORDER BY ord)
                 FROM jsonb_array_elements_text(${prefixJson}::jsonb) WITH ORDINALITY AS t(value, ord)),
                ARRAY[]::text[]
              ) || id AS newpath,
              ${newDepth}::int AS newdepth
            FROM "Control"
            WHERE id = ${input.controlId}
            UNION ALL
            SELECT c.id, s.newpath || c.id, s.newdepth + 1
            FROM "Control" c
            JOIN subtree s ON c."parentId" = s.id
          )
          UPDATE "Control" c
          SET path = to_jsonb(s.newpath), depth = s.newdepth
          FROM subtree s
          WHERE c.id = s.id
        `;
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_MOVED",
        entity: "Control",
        entityId: input.controlId,
        changes: {
          fromParentId: control.parentId,
          toParentId: input.newParentId,
          newDepth,
        },
      });

      return { id: input.controlId, parentId: input.newParentId, depth: newDepth };
    }),

  /**
   * Bulk-reorder siblings that share `parentId` within a framework. Every id in
   * `orderedControlIds` must be an existing sibling of that parent in the caller's
   * org. Emits `CONTROL_REORDERED`.
   */
  reorder: managerProcedure
    .input(
      z.object({
        frameworkId: z.string().min(1),
        parentId: z.string().min(1).nullable(),
        orderedControlIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const framework = await ctx.prisma.framework.findFirst({
        where: { id: input.frameworkId, organizationId },
        select: { id: true },
      });
      if (!framework) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      // Every id must be an actual sibling under this parent+framework. Comparing the
      // fetched count to the input length also rejects duplicates and foreign ids.
      const siblings = await ctx.prisma.control.findMany({
        where: {
          id: { in: input.orderedControlIds },
          frameworkId: input.frameworkId,
          parentId: input.parentId,
        },
        select: { id: true },
      });
      const uniqueInput = new Set(input.orderedControlIds);
      if (siblings.length !== uniqueInput.size || uniqueInput.size !== input.orderedControlIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "orderedControlIds must be the exact set of siblings under this parent.",
        });
      }

      await ctx.prisma.$transaction(
        input.orderedControlIds.map((id, index) =>
          ctx.prisma.control.update({
            where: { id },
            data: { sortOrder: index },
          }),
        ),
      );

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_REORDERED",
        entity: "Control",
        entityId: input.parentId ?? input.frameworkId,
        changes: {
          frameworkId: input.frameworkId,
          parentId: input.parentId,
          orderedControlIds: input.orderedControlIds,
        },
      });

      return { count: input.orderedControlIds.length };
    }),

  /**
   * Return the full control hierarchy for a framework as a nested tree, org-scoped.
   * Fetches every control in a single query (no N+1) and assembles the tree in memory,
   * ordered by depth then sortOrder.
   */
  getTree: orgProcedure
    .input(z.object({ frameworkId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const framework = await ctx.prisma.framework.findFirst({
        where: { id: input.frameworkId, organizationId: ctx.session.user.organizationId },
        select: { id: true },
      });
      if (!framework) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Framework not found for the current organization.",
        });
      }

      const controls = await ctx.prisma.control.findMany({
        where: { frameworkId: input.frameworkId },
        include: { _count: { select: { evidence: true } } },
        orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      });

      type TreeNode = {
        id: string;
        frameworkId: string;
        parentId: string | null;
        code: string | undefined;
        domain: string;
        title: string;
        description: string;
        guidance: string | undefined;
        status: ControlStatus;
        depth: number;
        sortOrder: number;
        evidenceCount: number;
        children: TreeNode[];
      };

      const nodes = new Map<string, TreeNode>();
      for (const c of controls) {
        nodes.set(c.id, {
          id: c.id,
          frameworkId: c.frameworkId,
          parentId: c.parentId,
          code: c.code ?? undefined,
          domain: c.domain,
          title: c.title,
          description: c.description,
          guidance: c.guidance ?? undefined,
          status: c.status,
          depth: c.depth,
          sortOrder: c.sortOrder,
          evidenceCount: c._count.evidence,
          children: [],
        });
      }

      const roots: TreeNode[] = [];
      // Because rows are ordered by depth ascending, every parent is already in the
      // map before its children are visited.
      for (const c of controls) {
        const node = nodes.get(c.id)!;
        const parent = c.parentId ? nodes.get(c.parentId) : undefined;
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }

      return { frameworkId: input.frameworkId, total: controls.length, roots };
    }),

  /**
   * Delete a control. A control with children is only removed when `cascade` is true,
   * which deletes the entire subtree (transaction-wrapped; DB cascade on the
   * self-relation removes descendants). Emits `CONTROL_DELETED` with `deletedCount`.
   */
  delete: managerProcedure
    .input(
      z.object({
        controlId: z.string().min(1),
        cascade: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const control = await loadControlInOrg(ctx.prisma, input.controlId, organizationId);

      const childCount = await ctx.prisma.control.count({
        where: { parentId: input.controlId },
      });

      if (childCount > 0 && !input.cascade) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Control has child controls. Re-run with cascade: true to delete the entire subtree.",
        });
      }

      const deletedCount = await ctx.prisma.$transaction(async (tx) => {
        // Count node + all descendants via parentId walk (robust regardless of path).
        const rows = await tx.$queryRaw<{ n: number }[]>`
          WITH RECURSIVE subtree AS (
            SELECT id FROM "Control" WHERE id = ${input.controlId}
            UNION ALL
            SELECT c.id FROM "Control" c JOIN subtree s ON c."parentId" = s.id
          )
          SELECT COUNT(*)::int AS n FROM subtree
        `;
        const count = rows[0]?.n ?? 1;
        // Deleting the node cascades to descendants via the self-relation FK.
        await tx.control.delete({ where: { id: input.controlId } });
        return count;
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONTROL_DELETED",
        entity: "Control",
        entityId: input.controlId,
        changes: {
          title: control.title,
          deletedCount,
          cascade: input.cascade,
        },
      });

      return { deletedCount };
    }),
});
