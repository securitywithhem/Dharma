import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { createAuditLog } from "@/server/audit-log";
import { getConnectorAdapter } from "@/server/connectors/registry";
import {
  addOrUpdateRepeatableJob,
  removeRepeatableJob,
  enqueueImmediateCollection,
} from "@/server/queue/connectorQueue";

const DEFAULT_SCHEDULE = "0 3 * * *"; // daily at 03:00, per PRD "every 24h check"

// Lightweight structural check for a 5-field cron expression — not a full
// parser, just enough to reject obviously malformed input before it reaches
// BullMQ's repeat scheduler.
const CRON_FIELD = /^[0-9*,\-/]+$/;
const cronSchema = z.string().refine((value) => {
  const fields = value.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f));
}, "Must be a valid 5-field cron expression, e.g. \"0 3 * * *\"");

async function loadOrgScopedMapping(
  prisma: any,
  id: string,
  organizationId: string,
) {
  const mapping = await prisma.evidenceMapping.findFirst({
    where: { id, connector: { organizationId } },
    include: { connector: true, control: { select: { id: true, title: true, domain: true } } },
  });

  if (!mapping) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evidence mapping not found." });
  }

  return mapping;
}

export const evidenceMappingRouter = createTRPCRouter({
  listByConnector: orgProcedure
    .input(z.object({ connectorId: z.string() }))
    .query(async ({ ctx, input }) => {
      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.connectorId, organizationId: ctx.session.user.organizationId },
        select: { id: true },
      });
      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found." });
      }

      return ctx.prisma.evidenceMapping.findMany({
        where: { connectorId: input.connectorId },
        include: {
          control: {
            select: {
              id: true,
              title: true,
              domain: true,
              framework: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  listByControl: orgProcedure
    .input(z.object({ controlId: z.string() }))
    .query(async ({ ctx, input }) => {
      const control = await ctx.prisma.control.findFirst({
        where: {
          id: input.controlId,
          framework: { organizationId: ctx.session.user.organizationId },
        },
        select: { id: true },
      });
      if (!control) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Control not found." });
      }

      return ctx.prisma.evidenceMapping.findMany({
        where: { controlId: input.controlId },
        include: {
          connector: { select: { id: true, name: true, type: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: permissionProcedure("connectors.manage")
    .input(
      z.object({
        connectorId: z.string(),
        controlId: z.string(),
        evidenceType: z.string().min(1),
        schedule: cronSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.connectorId, organizationId },
      });
      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found." });
      }

      const control = await ctx.prisma.control.findFirst({
        where: { id: input.controlId, framework: { organizationId } },
        select: { id: true },
      });
      if (!control) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Control not found." });
      }

      let availableTypes: string[];
      try {
        const adapter = getConnectorAdapter(connector.type);
        availableTypes = adapter.listAvailableEvidenceTypes();
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }

      if (!availableTypes.includes(input.evidenceType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${input.evidenceType}" is not an available evidence type for this connector. Available: ${availableTypes.join(", ")}`,
        });
      }

      const schedule = input.schedule ?? DEFAULT_SCHEDULE;

      const mapping = await ctx.prisma.evidenceMapping.create({
        data: {
          connectorId: input.connectorId,
          controlId: input.controlId,
          evidenceType: input.evidenceType,
          schedule,
        },
      });

      await addOrUpdateRepeatableJob(mapping.id, schedule);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_MAPPING_CREATED",
        entity: "EvidenceMapping",
        entityId: mapping.id,
        changes: {
          connectorId: input.connectorId,
          controlId: input.controlId,
          evidenceType: input.evidenceType,
          schedule,
        },
      });

      return mapping;
    }),

  update: permissionProcedure("connectors.manage")
    .input(z.object({ id: z.string(), schedule: cronSchema }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const mapping = await loadOrgScopedMapping(ctx.prisma, input.id, organizationId);

      const updated = await ctx.prisma.evidenceMapping.update({
        where: { id: input.id },
        data: { schedule: input.schedule },
      });

      await addOrUpdateRepeatableJob(input.id, input.schedule);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_MAPPING_UPDATED",
        entity: "EvidenceMapping",
        entityId: input.id,
        changes: { previousSchedule: mapping.schedule, newSchedule: input.schedule },
      });

      return updated;
    }),

  delete: permissionProcedure("connectors.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const mapping = await loadOrgScopedMapping(ctx.prisma, input.id, organizationId);

      await ctx.prisma.evidenceMapping.delete({ where: { id: input.id } });

      // Must happen after the DB delete succeeds, but a failure here would
      // leak an orphaned repeatable job — removeRepeatableJob is idempotent
      // (no-ops if the job doesn't exist), so it's safe to also call it
      // defensively from a cleanup pass if this ever throws.
      await removeRepeatableJob(input.id);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_MAPPING_DELETED",
        entity: "EvidenceMapping",
        entityId: input.id,
        changes: {
          connectorId: mapping.connectorId,
          controlId: mapping.controlId,
          evidenceType: mapping.evidenceType,
        },
      });

      return { deleted: true };
    }),

  triggerNow: permissionProcedure("connectors.manage")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const mapping = await loadOrgScopedMapping(ctx.prisma, input.id, organizationId);

      const jobId = await enqueueImmediateCollection(input.id);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_MAPPING_TRIGGERED",
        entity: "EvidenceMapping",
        entityId: input.id,
        changes: { connectorId: mapping.connectorId, controlId: mapping.controlId, jobId },
      });

      return { jobId };
    }),
});
