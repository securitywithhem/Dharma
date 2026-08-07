import { MarketplaceService } from "@/server/services/marketplace";
import { prisma as db } from "@/server/db";
import { redis } from "@/lib/redis";
import { ItemType } from "@prisma/client";

jest.mock("@/server/db", () => ({
  prisma: {
    marketplaceItem: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    importedItem: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/redis", () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    // WAVE 5.2 (BE-8): `keys` is deliberately absent now. Publishing used to
    // call redis.keys("marketplace:public:*") to clear the list cache; KEYS is
    // O(keyspace) and blocks the Redis single thread shared by all 14 BullMQ
    // queues. Invalidation is now an O(1) INCR of a generation counter that
    // forms part of every list cache key. Leaving `keys` unmocked here means a
    // regression back to KEYS fails this suite loudly rather than silently.
    incr: jest.fn().mockResolvedValue(1),
  },
}));

describe("MarketplaceService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getPublicItems returns items and caches result", async () => {
    const mockItems = [{ id: "1", name: "Test Item" }];
    (db.marketplaceItem.findMany as jest.Mock).mockResolvedValue(mockItems);
    (db.marketplaceItem.count as jest.Mock).mockResolvedValue(1);
    (redis.get as jest.Mock).mockResolvedValue(null);

    const result = await MarketplaceService.getPublicItems(db);

    expect(result.items).toEqual(mockItems);
    expect(result.count).toBe(1);
    expect(redis.setex).toHaveBeenCalled();
  });

  it("getPublicItems returns from cache if available", async () => {
    const cachedData = { items: [{ id: "2" }], count: 1 };
    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(cachedData));

    const result = await MarketplaceService.getPublicItems(db);

    expect(result.items).toEqual(cachedData.items);
    expect(db.marketplaceItem.findMany).not.toHaveBeenCalled();
  });

  it("publishItem creates new item and clears cache", async () => {
    const mockItem = { id: "123", name: "New Framework", slug: "new-fw" };
    (db.marketplaceItem.create as jest.Mock).mockResolvedValue(mockItem);

    await MarketplaceService.publishItem(db, "user-1", {
      type: ItemType.FRAMEWORK,
      name: "New Framework",
      slug: "new-fw",
      description: "Test description",
      category: "Compliance",
      tags: [],
      metadata: {}
    });

    expect(db.marketplaceItem.create).toHaveBeenCalled();
    // List cache invalidated by bumping the generation counter, not by KEYS.
    expect(redis.incr).toHaveBeenCalledWith("marketplace:public:version");
    expect((redis as unknown as Record<string, unknown>).keys).toBeUndefined();
  });
});
