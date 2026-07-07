import { createTRPCRouter, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { ImportService } from '@/server/services/import';
import { TRPCError } from '@trpc/server';

export const importRouter = createTRPCRouter({
  /**
   * Validate import before proceeding (check limits, duplicates, etc.)
   */
  validateImport: protectedProcedure
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
  importFramework: protectedProcedure
    .input(
      z.object({
        marketplaceItemId: z.string(),
        frameworkNameOverride: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ImportService.importFramework({
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        marketplaceItemId: input.marketplaceItemId,
        frameworkNameOverride: input.frameworkNameOverride
      });
    }),

  /**
   * Get all imported items for current org.
   */
  getImportedItems: protectedProcedure.query(async ({ ctx }) => {
    return ImportService.getImportedItems(ctx.session.user.organizationId);
  }),

  /**
   * Check if an imported item has updates available.
   */
  checkForUpdate: protectedProcedure
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
  unimportFramework: protectedProcedure
    .input(
      z.object({
        importedItemId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ImportService.unimportFramework(
        input.importedItemId, 
        ctx.session.user.organizationId,
        ctx.session.user.id
      );
    }),
});
