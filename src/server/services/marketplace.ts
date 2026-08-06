// WAVE 5.2 — marketplace service.
//
// Two structural changes from the original (fullstack-audit-2026-08-06):
//
//  * BE-7: every method now takes the caller's prisma client instead of
//    importing the `prisma` singleton directly. This was the only service in
//    the codebase that could not be given a test client.
//
//  * BE-8: publishing no longer calls `redis.keys("marketplace:public:*")`.
//    KEYS is O(total keyspace) and blocks the Redis single thread — and that
//    is the *same* Redis instance backing all 14 BullMQ queues, so a marketplace
//    write could stall unrelated job processing. The list cache is now
//    invalidated by bumping a version counter that is part of every list cache
//    key, so invalidation is a single O(1) INCR and stale entries simply age
//    out under their existing TTL.
import { redis } from "@/lib/redis";
import { ItemType, Prisma } from "@prisma/client";
import type { PrismaLike } from "@/server/trpc";

const CACHE_TTL = 3600; // 1 hour

// Bumping this invalidates every list cache entry at once, without scanning.
const LIST_VERSION_KEY = "marketplace:public:version";

/**
 * Current list-cache generation. Missing key reads as generation 0, so a cold
 * Redis simply starts a new generation rather than erroring.
 */
async function currentListVersion(): Promise<string> {
  try {
    return (await redis.get(LIST_VERSION_KEY)) ?? "0";
  } catch {
    // Redis unreachable — fall back to an uncacheable generation so callers
    // read through to the database rather than failing.
    return "nocache";
  }
}

async function bumpListVersion(): Promise<void> {
  try {
    await redis.incr(LIST_VERSION_KEY);
  } catch {
    // Invalidation failed; entries still expire under CACHE_TTL. Worth no more
    // than a stale list for up to an hour, and never worth failing the write.
  }
}

async function invalidateItem(id: string, slug: string): Promise<void> {
  try {
    await redis.del(`marketplace:item:${id}`, `marketplace:item:${slug}`);
  } catch {
    // Same reasoning as bumpListVersion.
  }
}

export class MarketplaceService {
  /**
   * Fetch public marketplace items with caching.
   */
  static async getPublicItems(
    db: PrismaLike,
    params?: {
      type?: ItemType;
      category?: string;
      search?: string;
      take?: number;
      skip?: number;
    }
  ) {
    const version = await currentListVersion();
    const cacheKey = `marketplace:public:v${version}:${JSON.stringify(params || {})}`;

    if (version !== "nocache") {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch {
        // Read through to the database.
      }
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

    const [items, count] = await Promise.all([
      db.marketplaceItem.findMany({
        where,
        include: { author: { select: { id: true, name: true, image: true } } },
        take,
        skip,
        orderBy: { ratings: "desc" },
      }),
      db.marketplaceItem.count({ where }),
    ]);

    const result = { items, count };

    if (version !== "nocache") {
      try {
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
      } catch {
        // Caching is best-effort.
      }
    }

    return result;
  }

  /**
   * Get item by ID or slug.
   */
  static async getItem(db: PrismaLike, identifier: string) {
    const cacheKey = `marketplace:item:${identifier}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Read through to the database.
    }

    const item = await db.marketplaceItem.findFirst({
      where: { OR: [{ id: identifier }, { slug: identifier }] },
      include: {
        author: { select: { id: true, name: true, image: true } },
        reviews: {
          include: { reviewer: { select: { id: true, name: true, image: true } } },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    if (item) {
      try {
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(item));
      } catch {
        // Best-effort.
      }
    }

    return item;
  }

  /**
   * Publish (create) or update a marketplace item.
   *
   * Never sets `isPublic`. A newly published item is invisible until a
   * platform admin approves it via setItemVisibility — that is the whole
   * moderation gate, and accepting a caller-supplied `isPublic` here is what
   * made it bypassable (BE-2).
   */
  static async publishItem(
    db: PrismaLike,
    userId: string,
    data: {
      id?: string;
      type: ItemType;
      name: string;
      slug: string;
      description: string;
      shortDescription?: string;
      price?: number;
      category: string;
      tags: string[];
      metadata: unknown;
    }
  ) {
    const { id, ...itemData } = data;

    let item;
    if (id) {
      // Authorship check on update. Note create has no equivalent check to
      // omit — authorId is set from the session, never from input.
      const existing = await db.marketplaceItem.findUnique({
        where: { id },
        select: { id: true, authorId: true, slug: true },
      });
      if (!existing || existing.authorId !== userId) {
        // Same message for "not yours" and "doesn't exist", so this cannot be
        // used to enumerate other publishers' unlisted items.
        throw new MarketplaceAuthorizationError();
      }

      item = await db.marketplaceItem.update({
        where: { id },
        data: { ...itemData, metadata: itemData.metadata as Prisma.InputJsonValue },
      });

      await invalidateItem(item.id, item.slug);
      if (existing.slug !== item.slug) {
        await invalidateItem(existing.id, existing.slug);
      }
    } else {
      item = await db.marketplaceItem.create({
        data: {
          ...itemData,
          metadata: (itemData.metadata ?? {}) as Prisma.InputJsonValue,
          authorId: userId,
        },
      });
    }

    await bumpListVersion();

    return item;
  }

  /**
   * Set catalogue visibility. The only writer of `isPublic`, called from
   * platform-admin approve/reject.
   */
  static async setItemVisibility(db: PrismaLike, id: string, isPublic: boolean) {
    const item = await db.marketplaceItem.update({
      where: { id },
      data: { isPublic, publishedAt: isPublic ? new Date() : null },
    });

    await invalidateItem(item.id, item.slug);
    await bumpListVersion();

    return item;
  }

  /**
   * Add a review and update the item's average rating.
   */
  static async addReview(
    db: PrismaLike,
    userId: string,
    marketplaceItemId: string,
    data: { rating: number; title: string; content: string }
  ) {
    const review = await db.$transaction(async (tx) => {
      const newReview = await tx.marketplaceReview.upsert({
        where: {
          marketplaceItemId_reviewerId: { marketplaceItemId, reviewerId: userId },
        },
        update: data,
        create: { ...data, marketplaceItemId, reviewerId: userId },
      });

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

    const item = await db.marketplaceItem.findUnique({
      where: { id: marketplaceItemId },
      select: { id: true, slug: true },
    });
    if (item) {
      await invalidateItem(item.id, item.slug);
      // Ratings drive the list's ORDER BY, so a review changes list results.
      await bumpListVersion();
    }

    return review;
  }

  /**
   * Import an item into an organization.
   */
  static async importItem(
    db: PrismaLike,
    organizationId: string,
    marketplaceItemId: string
  ) {
    const item = await db.marketplaceItem.findUnique({
      where: { id: marketplaceItemId },
    });

    if (!item) {
      throw new MarketplaceNotFoundError("Item not found");
    }
    // Only approved items are importable. Without this, an item that was never
    // approved (or was rejected) could still be pulled into a tenant by id.
    if (!item.isPublic) {
      throw new MarketplaceNotFoundError("Item not found");
    }

    const imported = await db.importedItem.upsert({
      where: {
        organizationId_marketplaceItemId: { organizationId, marketplaceItemId },
      },
      update: { itemVersion: item.version },
      create: {
        organizationId,
        marketplaceItemId,
        itemType: item.type,
        itemName: item.name,
        itemVersion: item.version,
      },
    });

    await db.marketplaceItem.update({
      where: { id: marketplaceItemId },
      data: { downloads: { increment: 1 } },
    });

    await invalidateItem(item.id, item.slug);

    return imported;
  }
}

/**
 * Domain errors, mapped to TRPCError codes by the router.
 *
 * The service is called from a worker context too, so it does not import
 * TRPCError itself — but it must not throw bare `Error` either, which is what
 * made every marketplace failure reach the client as an unactionable
 * INTERNAL_SERVER_ERROR (BE-7).
 */
export class MarketplaceAuthorizationError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message = "You are not the author of this item.") {
    super(message);
    this.name = "MarketplaceAuthorizationError";
  }
}

export class MarketplaceNotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(message = "Item not found.") {
    super(message);
    this.name = "MarketplaceNotFoundError";
  }
}
