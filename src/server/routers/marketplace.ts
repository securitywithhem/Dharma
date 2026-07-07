import { z } from "zod";
import { ItemType } from "@prisma/client";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "@/server/trpc";
import { MarketplaceService } from "@/server/services/marketplace";
import { prisma as db } from "@/server/db";

export const marketplaceRouter = createTRPCRouter({
  // Public operations
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
    .query(async ({ input }) => {
      return MarketplaceService.getPublicItems(input);
    }),

  getItem: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input }) => {
      const item = await MarketplaceService.getItem(input.identifier);
      if (!item) {
        throw new Error("Item not found");
      }
      return item;
    }),

  getCategories: publicProcedure
    .query(async () => {
      const groups = await db.marketplaceItem.groupBy({
        by: ['category'],
        _count: { id: true },
        where: { isPublic: true },
      });
      return groups.map(g => ({ name: g.category, count: g._count.id })).sort((a, b) => b.count - a.count);
    }),

  getFeatured: publicProcedure
    .query(async () => {
      return db.marketplaceItem.findMany({
        where: { isPublic: true },
        orderBy: [{ ratings: "desc" }, { downloads: "desc" }],
        take: 3,
        include: { author: { select: { name: true } } }
      });
    }),

  // Protected operations (Require Auth)
  addReview: protectedProcedure
    .input(
      z.object({
        marketplaceItemId: z.string(),
        rating: z.number().min(1).max(5),
        title: z.string().min(3),
        content: z.string().min(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return MarketplaceService.addReview(ctx.session.user.id, input.marketplaceItemId, {
        rating: input.rating,
        title: input.title,
        content: input.content,
      });
    }),

  importItem: protectedProcedure
    .input(z.object({ marketplaceItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.organizationId) {
        throw new Error("User must belong to an organization to import items");
      }
      return MarketplaceService.importItem(
        ctx.session.user.organizationId,
        input.marketplaceItemId
      );
    }),

  // Publisher operations
  publishItem: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        type: z.nativeEnum(ItemType),
        name: z.string().min(3),
        slug: z.string().min(3),
        description: z.string().min(10),
        shortDescription: z.string().optional(),
        price: z.number().min(0).optional(),
        category: z.string(),
        tags: z.array(z.string()),
        metadata: z.any(), // JSON
        isPublic: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Basic check, in reality verify role is PUBLISHER or ADMIN
      return MarketplaceService.publishItem(ctx.session.user.id, input);
    }),

  getPublisherItems: protectedProcedure
    .query(async ({ ctx }) => {
      return db.marketplaceItem.findMany({
        where: { authorId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Admin operations
  getPendingItems: protectedProcedure
    .query(async ({ ctx }) => {
      // In reality check if user is ADMIN
      if (ctx.session.user.role !== "ADMIN") {
        throw new Error("Unauthorized");
      }
      return db.marketplaceItem.findMany({
        where: { isPublic: false },
        include: { author: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      });
    }),

  approveItem: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.role !== "ADMIN") throw new Error("Unauthorized");
      
      const item = await db.marketplaceItem.update({
        where: { id: input.id },
        data: { isPublic: true, publishedAt: new Date() },
      });
      return item;
    }),
});
