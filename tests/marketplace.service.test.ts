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
    keys: jest.fn().mockResolvedValue([]),
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

    const result = await MarketplaceService.getPublicItems();

    expect(result.items).toEqual(mockItems);
    expect(result.count).toBe(1);
    expect(redis.setex).toHaveBeenCalled();
  });

  it("getPublicItems returns from cache if available", async () => {
    const cachedData = { items: [{ id: "2" }], count: 1 };
    (redis.get as jest.Mock).mockResolvedValue(JSON.stringify(cachedData));

    const result = await MarketplaceService.getPublicItems();

    expect(result.items).toEqual(cachedData.items);
    expect(db.marketplaceItem.findMany).not.toHaveBeenCalled();
  });

  it("publishItem creates new item and clears cache", async () => {
    const mockItem = { id: "123", name: "New Framework", slug: "new-fw" };
    (db.marketplaceItem.create as jest.Mock).mockResolvedValue(mockItem);

    await MarketplaceService.publishItem("user-1", {
      type: ItemType.FRAMEWORK,
      name: "New Framework",
      slug: "new-fw",
      description: "Test description",
      category: "Compliance",
      tags: [],
      metadata: {}
    });

    expect(db.marketplaceItem.create).toHaveBeenCalled();
    expect(redis.keys).toHaveBeenCalled();
  });
});
