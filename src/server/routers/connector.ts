import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ConnectorType, ConnectorStatus } from "@prisma/client";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { createAuditLog } from "@/server/audit-log";
import { encryptConnectorConfig, decryptConnectorConfig } from "@/server/lib/crypto/connectorVault";
import { getConnectorAdapter } from "@/server/connectors/registry";
import { removeRepeatableJob } from "@/server/queue/connectorQueue";
import { checkRateLimit } from "@/server/lib/rateLimit";

const ConfigSchema = z.record(z.any());

export const connectorRouter = createTRPCRouter({
  list: orgProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.prisma.connector.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        name: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return connectors;
  }),

  getById: orgProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.id, organizationId: ctx.session.user.organizationId },
        select: {
          id: true,
          type: true,
          name: true,
          status: true,
          lastSyncAt: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      }
      return connector;
    }),

  listAvailableEvidenceTypes: managerProcedure
    .input(z.object({ type: z.nativeEnum(ConnectorType) }))
    .query(async ({ input }) => {
      try {
        const adapter = getConnectorAdapter(input.type);
        return adapter.listAvailableEvidenceTypes();
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message,
        });
      }
    }),

  // Pre-save test used by the config wizard, before a Connector row exists.
  precheckConnection: managerProcedure
    .input(z.object({
      type: z.nativeEnum(ConnectorType),
      config: ConfigSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(`${ctx.session.user.organizationId}:connector.precheckConnection`, 10, 60_000);
      try {
        const adapter = getConnectorAdapter(input.type);
        const success = await adapter.testConnection(input.config);
        return { success };
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Connection test failed: ${err.message}`,
        });
      }
    }),

  // Re-tests an existing, saved connector: decrypts its stored config and
  // updates status/lastError based on the result.
  testConnection: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      checkRateLimit(`${organizationId}:connector.testConnection`, 10, 60_000);

      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.id, organizationId },
      });

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      }

      await ctx.prisma.connector.update({
        where: { id: input.id },
        data: { status: ConnectorStatus.TESTING },
      });

      const adapter = getConnectorAdapter(connector.type);
      const config = decryptConnectorConfig(connector.config as string);

      let status: ConnectorStatus;
      let lastError: string | null = null;
      try {
        await adapter.testConnection(config);
        status = ConnectorStatus.CONNECTED;
      } catch (err: any) {
        status = ConnectorStatus.ERROR;
        lastError = err.message;
      }

      const updated = await ctx.prisma.connector.update({
        where: { id: input.id },
        data: { status, lastError, lastSyncAt: status === ConnectorStatus.CONNECTED ? new Date() : connector.lastSyncAt },
        select: { id: true, type: true, name: true, status: true, lastError: true, lastSyncAt: true },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_TESTED",
        entity: "Connector",
        entityId: input.id,
        changes: { status },
      });

      return updated;
    }),

  create: managerProcedure
    .input(z.object({
      type: z.nativeEnum(ConnectorType),
      name: z.string().min(1).max(120),
      config: ConfigSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      
      try {
        const adapter = getConnectorAdapter(input.type);
        await adapter.testConnection(input.config);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Connection test failed: ${err.message}`,
        });
      }
      
      const encryptedConfig = encryptConnectorConfig(input.config);

      const connector = await ctx.prisma.connector.create({
        data: {
          organizationId,
          type: input.type,
          name: input.name,
          config: encryptedConfig,
          status: ConnectorStatus.CONNECTED,
        },
        select: {
          id: true,
          type: true,
          name: true,
          status: true,
          createdAt: true,
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_CREATED",
        entity: "Connector",
        entityId: connector.id,
        changes: { type: input.type, name: input.name },
      });

      return connector;
    }),

  update: managerProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(120).optional(),
      config: ConfigSchema.optional(),
      status: z.nativeEnum(ConnectorStatus).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.id, organizationId },
      });

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      }

      const updateData: any = {};
      if (input.name) updateData.name = input.name;
      if (input.status) updateData.status = input.status;
      
      if (input.config) {
        try {
          const adapter = getConnectorAdapter(connector.type);
          await adapter.testConnection(input.config);
        } catch (err: any) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Connection test failed: ${err.message}`,
          });
        }
        updateData.config = encryptConnectorConfig(input.config);
        updateData.status = ConnectorStatus.CONNECTED;
      }

      const updated = await ctx.prisma.connector.update({
        where: { id: input.id },
        data: updateData,
        select: { id: true, type: true, name: true, status: true, updatedAt: true },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_UPDATED",
        entity: "Connector",
        entityId: input.id,
        changes: input,
      });

      return updated;
    }),

  delete: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.id, organizationId },
        select: { id: true, type: true, name: true },
      });

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found" });
      }

      // EvidenceMapping rows cascade-delete at the DB level when the
      // connector is deleted, but their BullMQ repeatable jobs don't —
      // clean those up first so we don't leak orphaned schedules.
      const mappings = await ctx.prisma.evidenceMapping.findMany({
        where: { connectorId: input.id },
        select: { id: true },
      });
      await Promise.all(mappings.map((m) => removeRepeatableJob(m.id)));

      await ctx.prisma.connector.delete({ where: { id: input.id } });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_DELETED",
        entity: "Connector",
        entityId: input.id,
        changes: { type: connector.type, name: connector.name, evidenceMappingsRemoved: mappings.length },
      });

      return { deleted: true };
    }),
});
