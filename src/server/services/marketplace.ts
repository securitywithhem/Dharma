import { prisma as db } from "@/server/db";
import { redis } from "@/lib/redis";
import { ItemType, MarketplaceItem, Prisma } from "@prisma/client";

const CACHE_TTL = 3600; // 1 hour

export class MarketplaceService {
  /**
   * Fetch public marketplace items with caching
   */
  static async getPublicItems(params?: {
    type?: ItemType;
    category?: string;
    search?: string;
    take?: number;
    skip?: number;
  }) {
    const cacheKey = `marketplace:public:${JSON.stringify(params || {})}`;
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const { type, category, search, take = 50, skip = 0 } = params || {};

    const where: Prisma.MarketplaceItemWhereInput = {
      isPublic: true,
      ...(type && { type }),
      ...(category && { category }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { tags: { has: search } },
        ],
      }),
    };

    const items = await db.marketplaceItem.findMany({
      where,
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
      },
      take,
      skip,
      orderBy: { ratings: 'desc' },
    });

    const count = await db.marketplaceItem.count({ where });

    const result = { items, count };

    // Cache the result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

    return result;
  }

  /**
   * Get item by ID or Slug
   */
  static async getItem(identifier: string) {
    const cacheKey = `marketplace:item:${identifier}`;
    
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const item = await db.marketplaceItem.findFirst({
      where: {
        OR: [
          { id: identifier },
          { slug: identifier }
        ]
      },
      include: {
        author: {
          select: { id: true, name: true, image: true },
        },
        reviews: {
          include: {
            reviewer: {
              select: { id: true, name: true, image: true },
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });

    if (item) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(item));
    }

    return item;
  }

  /**
   * Publish or update a marketplace item
   */
  static async publishItem(
    userId: string,
    data: {
      id?: string; // If provided, update
      type: ItemType;
      name: string;
      slug: string;
      description: string;
      shortDescription?: string;
      price?: number;
      category: string;
      tags: string[];
      metadata?: any;
      isPublic?: boolean;
    }
  ) {
    const { id, ...itemData } = data;

    let item;
    if (id) {
      // Ensure user is author
      const existing = await db.marketplaceItem.findUnique({ where: { id } });
      if (!existing || existing.authorId !== userId) {
        throw new Error("Unauthorized or Item not found");
      }

      item = await db.marketplaceItem.update({
        where: { id },
        data: itemData,
      });

      // Invalidate cache
      await redis.del(`marketplace:item:${id}`);
      await redis.del(`marketplace:item:${item.slug}`);
    } else {
      item = await db.marketplaceItem.create({
        data: {
          ...itemData,
          metadata: itemData.metadata || {},
          authorId: userId,
        },
      });
    }

    // Clear public cache list (brute force pattern match is slow in Redis, but we use a prefix approach or just clear specific keys if possible, for MVP we can use keys or just let TTL expire)
    // Actually, let's use a standard KEYS pattern for MVP (though avoid in huge prod)
    const keys = await redis.keys("marketplace:public:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return item;
  }

  /**
   * Add a review and update average rating
   */
  static async addReview(
    userId: string,
    marketplaceItemId: string,
    data: { rating: number; title: string; content: string }
  ) {
    // Start a transaction to ensure rating integrity
    const review = await db.$transaction(async (tx: any) => {
      const newReview = await tx.marketplaceReview.upsert({
        where: {
          marketplaceItemId_reviewerId: {
            marketplaceItemId,
            reviewerId: userId,
          },
        },
        update: data,
        create: {
          ...data,
          marketplaceItemId,
          reviewerId: userId,
        },
      });

      // Recalculate avg rating
      const aggr = await tx.marketplaceReview.aggregate({
        where: { marketplaceItemId },
        _avg: { rating: true },
        _count: { rating: true },
      });

      await tx.marketplaceItem.update({
        where: { id: marketplaceItemId },
        data: {
          ratings: aggr._avg.rating || 0,
          reviewCount: aggr._count.rating || 0,
        },
      });

      return newReview;
    });

    const item = await db.marketplaceItem.findUnique({ where: { id: marketplaceItemId }});
    if (item) {
      await redis.del(`marketplace:item:${item.id}`);
      await redis.del(`marketplace:item:${item.slug}`);
    }

    return review;
  }

  /**
   * Import item to organization
   */
  static async importItem(organizationId: string, marketplaceItemId: string) {
    const item = await db.marketplaceItem.findUnique({
      where: { id: marketplaceItemId },
    });

    if (!item) throw new Error("Item not found");

    const imported = await db.importedItem.upsert({
      where: {
        organizationId_marketplaceItemId: {
          organizationId,
          marketplaceItemId,
        },
      },
      update: {
        itemVersion: item.version,
      },
      create: {
        organizationId,
        marketplaceItemId,
        itemType: item.type,
        itemName: item.name,
        itemVersion: item.version,
      },
    });

    // Increment downloads
    await db.marketplaceItem.update({
      where: { id: marketplaceItemId },
      data: { downloads: { increment: 1 } },
    });

    await redis.del(`marketplace:item:${item.id}`);
    await redis.del(`marketplace:item:${item.slug}`);

    return imported;
  }
}
