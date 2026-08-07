// WAVE 5.2 — marketplace hardening.
//
// This router was the one module in the codebase built to a different standard
// (fullstack-audit-2026-08-06 pattern P2): three of its comments said "in
// reality, check X" above code that did not check X, it was the only router
// throwing raw `Error` instead of `TRPCError`, one of two skipping
// orgProcedure, one of three with zero audit logging, and its service imported
// `prisma` directly so it could not be swapped in tests. It shipped enabled.
//
// Closes BE-2 (missing authorization), BE-5 (no audit trail), BE-6 (no
// orgProcedure), BE-7 (raw exceptions + direct prisma import).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ItemType } from "@prisma/client";
import {
  createTRPCRouter,
  publicProcedure,
  orgProcedure,
  platformAdminProcedure,
} from "@/server/trpc";
import {
  MarketplaceService,
  MarketplaceAuthorizationError,
  MarketplaceNotFoundError,
} from "@/server/services/marketplace";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { parseMarketplaceMetadata } from "@/server/services/marketplace/metadataSchema";
import { emitAuditEvent } from "@/server/services/audit/writer";

/**
 * Map the service's domain errors onto tRPC codes.
 *
 * BE-7: this router was the only one throwing raw `Error`, so every failure
 * reached the client as INTERNAL_SERVER_ERROR with the bare string
 * "Unauthorized" and no actionable code. Anything genuinely unexpected is
 * rethrown untouched so it still surfaces as a 500 rather than being
 * laundered into a friendly-looking 4xx.
 */
function asTRPCError(error: unknown): never {
  if (error instanceof MarketplaceAuthorizationError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  if (error instanceof MarketplaceNotFoundError) {
    throw new TRPCError({ code: error.code, message: error.message });
  }
  throw error;
}

export const marketplaceRouter = createTRPCRouter({
  // ----------------------------------------------------------------
  // Public operations
  // ----------------------------------------------------------------
  getPublicItems: publicProcedure
    .input(
      z.object({
        type: z.nativeEnum(ItemType).optional(),
        category: z.string().optional(),
        search: z.string().optional(),
        take: z.number().min(1).max(100).optional(),
        skip: z.number().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return MarketplaceService.getPublicItems(ctx.prisma, input);
    }),

  getItem: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await MarketplaceService.getItem(ctx.prisma, input.identifier);
      if (!item) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });
      }
      return item;
    }),

  getCategories: publicProcedure.query(async ({ ctx }) => {
    const groups = await ctx.prisma.marketplaceItem.groupBy({
      by: ["category"],
      _count: { id: true },
      where: { isPublic: true },
    });
    return groups
      .map((g) => ({ name: g.category, count: g._count.id }))
      .sort((a, b) => b.count - a.count);
  }),

  getFeatured: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.marketplaceItem.findMany({
      where: { isPublic: true },
      orderBy: [{ ratings: "desc" }, { downloads: "desc" }],
      take: 3,
      include: { author: { select: { name: true } } },
    });
  }),

  // ----------------------------------------------------------------
  // Tenant operations
  //
  // orgProcedure, not protectedProcedure (BE-6): enforceOrganizationContext
  // never ran here, so a session with no org reached the resolver with
  // organizationId "" and produced a Prisma 500 on an empty FK instead of the
  // clean UNAUTHORIZED every other router returns. Since WAVE 5.1 this also
  // brings the caller's row re-read, so a deactivated publisher stops
  // publishing immediately.
  // ----------------------------------------------------------------
  addReview: orgProcedure
    .input(
      z.object({
        marketplaceItemId: z.string(),
        rating: z.number().min(1).max(5),
        title: z.string().min(3).max(200),
        content: z.string().min(10).max(5_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return MarketplaceService.addReview(
        ctx.prisma,
        ctx.session.user.id,
        input.marketplaceItemId,
        { rating: input.rating, title: input.title, content: input.content }
      );
    }),

  importItem: orgProcedure
    .input(z.object({ marketplaceItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const imported = await MarketplaceService.importItem(
        ctx.prisma,
        organizationId,
        input.marketplaceItemId
      ).catch(asTRPCError);

      // BE-5: a third-party control set entering this tenant's compliance
      // programme is exactly the event an auditor asks about.
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "MARKETPLACE_ITEM_IMPORTED",
        entity: "ImportedItem",
        entityId: imported.id,
        changes: {
          marketplaceItemId: input.marketplaceItemId,
          itemName: imported.itemName,
          itemType: imported.itemType,
          itemVersion: imported.itemVersion,
        },
      });

      return imported;
    }),

  // ----------------------------------------------------------------
  // Publisher operations
  // ----------------------------------------------------------------
  publishItem: permissionProcedure("marketplace.publish")
    .input(
      z.object({
        id: z.string().optional(),
        type: z.nativeEnum(ItemType),
        name: z.string().min(3).max(200),
        slug: z
          .string()
          .min(3)
          .max(100)
          // Enforced rather than merely min(3): the slug is a public URL
          // identifier resolved by getItem alongside raw ids, so free-form
          // input here is both a routing ambiguity and an injection surface.
          .regex(
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            "Slug must be lowercase alphanumeric words separated by single hyphens."
          ),
        description: z.string().min(10).max(20_000),
        shortDescription: z.string().max(500).optional(),
        price: z.number().min(0).max(1_000_000).optional(),
        category: z.string().min(1).max(100),
        tags: z.array(z.string().min(1).max(50)).max(20),
        metadata: z.unknown(),
        // NOTE: `isPublic` is deliberately absent from this input.
        //
        // It used to be accepted here and passed straight into
        // marketplaceItem.create, which made the entire approveItem moderation
        // step bypassable by setting one boolean — the worst half of BE-2.
        // Visibility is server-controlled and only ever set by approveItem.
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validated against the declared ItemType, not accepted as free JSON.
      const metadata = parseMarketplaceMetadata(input.type, input.metadata);

      const item = await MarketplaceService.publishItem(
        ctx.prisma,
        ctx.session.user.id,
        { ...input, metadata }
      ).catch(asTRPCError);

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: input.id ? "MARKETPLACE_ITEM_UPDATED" : "MARKETPLACE_ITEM_PUBLISHED",
        entity: "MarketplaceItem",
        entityId: item.id,
        changes: { name: item.name, slug: item.slug, type: item.type },
      });

      return item;
    }),

  getPublisherItems: permissionProcedure("marketplace.publish").query(async ({ ctx }) => {
    return ctx.prisma.marketplaceItem.findMany({
      where: { authorId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
    });
  }),

  // ----------------------------------------------------------------
  // Platform moderation
  //
  // platformAdminProcedure, not `role === "ADMIN"` (BE-2): the old check read
  // the caller's role inside their OWN organization, so any customer's admin
  // could approve any other tenant's submission into the shared catalogue.
  // ----------------------------------------------------------------
  getPendingItems: platformAdminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.marketplaceItem.findMany({
      where: { isPublic: false },
      include: { author: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
  }),

  approveItem: platformAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.marketplaceItem.findUnique({
        where: { id: input.id },
        select: { id: true, isPublic: true, name: true, slug: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });
      }
      if (existing.isPublic) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Item is already public.",
        });
      }

      const item = await MarketplaceService.setItemVisibility(
        ctx.prisma,
        input.id,
        true
      );

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MARKETPLACE_ITEM_APPROVED",
        entity: "MarketplaceItem",
        entityId: item.id,
        changes: { name: item.name, slug: item.slug },
      });

      return item;
    }),

  rejectItem: platformAdminProcedure
    .input(z.object({ id: z.string(), reason: z.string().min(3).max(2_000) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.marketplaceItem.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, slug: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });
      }

      // Withdraw from the catalogue rather than delete: other tenants may
      // already have imported it, and ImportedItem.sourceItem is SetNull, so a
      // delete would silently strip their provenance (same reasoning as the
      // onDelete choice recorded on MarketplaceItem.authorId in the schema).
      const item = await MarketplaceService.setItemVisibility(
        ctx.prisma,
        input.id,
        false
      );

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MARKETPLACE_ITEM_REJECTED",
        entity: "MarketplaceItem",
        entityId: item.id,
        changes: { name: item.name, slug: item.slug, reason: input.reason },
      });

      return item;
    }),
});
