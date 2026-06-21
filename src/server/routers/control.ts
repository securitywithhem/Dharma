import { ControlStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";

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
});
