// WAVE 5.2 — orgProcedure + audit coverage.
//
// BE-6: every procedure here used bare `orgProcedure`, so
// enforceOrganizationContext never ran and a session with no org reached the
// resolvers with organizationId "" — importFramework then attempted a write
// against an empty FK and surfaced a Prisma 500 instead of the clean
// UNAUTHORIZED every other router returns.
//
// BE-5: this router wrote no audit entries at all, despite importFramework /
// unimportFramework being exactly the event an auditor asks about — a
// third-party control set entering or leaving a tenant's compliance programme.
import { createTRPCRouter, orgProcedure } from '../trpc';
import { z } from 'zod';
import { ImportService } from '@/server/services/import';
import { emitAuditEvent } from '@/server/services/audit/writer';
import { TRPCError } from '@trpc/server';

export const importRouter = createTRPCRouter({
  /**
   * Validate import before proceeding (check limits, duplicates, etc.)
   */
  validateImport: orgProcedure
    .input(
      z.object({
        marketplaceItemId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const item = await ImportService.validateImport(
          ctx.session.user.organizationId,
          input.marketplaceItemId
        );

        return {
          valid: true,
          item: {
            id: item.id,
            name: item.name,
            type: item.type,
            price: item.price,
          },
        };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof TRPCError ? error.message : 'Validation failed',
        };
      }
    }),

  /**
   * Import a framework into the organization.
   */
  importFramework: orgProcedure
    .input(
      z.object({
        marketplaceItemId: z.string(),
        frameworkNameOverride: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ImportService.importFramework({
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        marketplaceItemId: input.marketplaceItemId,
        frameworkNameOverride: input.frameworkNameOverride
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: 'FRAMEWORK_IMPORTED',
        entity: 'Framework',
        entityId: result.framework.id,
        changes: {
          marketplaceItemId: input.marketplaceItemId,
          frameworkName: result.framework.name,
          controlCount: result.controlCount,
        },
      });

      return result;
    }),

  /**
   * Get all imported items for current org.
   */
  getImportedItems: orgProcedure.query(async ({ ctx }) => {
    return ImportService.getImportedItems(ctx.session.user.organizationId);
  }),

  /**
   * Check if an imported item has updates available.
   */
  checkForUpdate: orgProcedure
    .input(
      z.object({
        importedItemId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return ImportService.checkForUpdate(input.importedItemId);
    }),

  /**
   * Unimport a framework (remove it).
   */
  unimportFramework: orgProcedure
    .input(
      z.object({
        importedItemId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Captured before the delete — afterwards there is nothing left to name
      // in the audit entry, which is precisely when an auditor wants one.
      const imported = await ctx.prisma.importedItem.findFirst({
        where: {
          id: input.importedItemId,
          organizationId: ctx.session.user.organizationId,
        },
        select: { id: true, itemName: true, itemType: true, itemVersion: true },
      });

      const result = await ImportService.unimportFramework(
        input.importedItemId,
        ctx.session.user.organizationId,
        ctx.session.user.id
      );

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: 'FRAMEWORK_UNIMPORTED',
        entity: 'ImportedItem',
        entityId: input.importedItemId,
        changes: {
          itemName: imported?.itemName ?? null,
          itemType: imported?.itemType ?? null,
          itemVersion: imported?.itemVersion ?? null,
        },
      });

      return result;
    }),
});
