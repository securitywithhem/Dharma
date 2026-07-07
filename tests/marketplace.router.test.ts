import { marketplaceRouter } from "@/server/routers/marketplace";
import { MarketplaceService } from "@/server/services/marketplace";
import { ItemType } from "@prisma/client";

jest.mock("@/server/services/marketplace", () => ({
  MarketplaceService: {
    getPublicItems: jest.fn(),
    getItem: jest.fn(),
    publishItem: jest.fn(),
  },
}));

jest.mock("@/server/db", () => ({
  prisma: {
    marketplaceItem: {
      findMany: jest.fn(),
      update: jest.fn(),
    }
  }
}));

describe("marketplaceRouter", () => {
  it("getPublicItems calls service", async () => {
    const mockData = { items: [], count: 0 };
    (MarketplaceService.getPublicItems as jest.Mock).mockResolvedValue(mockData);
    
    // We create a caller without a session for public endpoints
    const caller = marketplaceRouter.createCaller({
      session: null,
      req: {} as any,
      res: {} as any,
    } as any);

    const result = await caller.getPublicItems({ type: ItemType.FRAMEWORK });
    expect(result).toEqual(mockData);
    expect(MarketplaceService.getPublicItems).toHaveBeenCalledWith({ type: ItemType.FRAMEWORK });
  });

  it("publishItem calls service with auth ctx", async () => {
    const mockItem = { id: "item1" };
    (MarketplaceService.publishItem as jest.Mock).mockResolvedValue(mockItem);
    
    const caller = marketplaceRouter.createCaller({
      session: { user: { id: "user1", role: "PUBLISHER" } },
      req: {} as any,
      res: {} as any,
    } as any);

    const result = await caller.publishItem({
      type: ItemType.FRAMEWORK,
      name: "Item",
      slug: "item",
      description: "description text goes here",
      category: "Cat",
      tags: [],
      metadata: {}
    });
    
    expect(result).toEqual(mockItem);
    expect(MarketplaceService.publishItem).toHaveBeenCalledWith("user1", expect.any(Object));
  });
});
