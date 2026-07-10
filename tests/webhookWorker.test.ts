// jest.mock() factories are hoisted above regular const declarations, so
// the mock Prisma object must be built entirely inside the factory rather
// than closed over from an outer variable (see connectorEvidenceWorker.test.ts
// for the same pattern and rationale).

jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client");
  const mockPrismaInstance = {
    webhook: {
      findUnique: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
    },
  };
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrismaInstance),
  };
});

const { PrismaClient: MockedPrismaClient } = jest.requireMock("@prisma/client") as {
  PrismaClient: new () => any;
};
const mockPrisma = new MockedPrismaClient();

jest.mock("@/server/lib/crypto/webhookVault", () => ({
  decryptWebhookSecret: jest.fn(() => "whsec_test_secret"),
}));

// Prevent the real BullMQ Queue (and its Redis connection) from being
// constructed as an import side effect of webhookQueue.ts.
jest.mock("@/server/queue/webhookQueue", () => ({
  WEBHOOK_DELIVERY_QUEUE_NAME: "webhook-delivery",
}));

import { processWebhookDeliveryJob } from "@/server/queue/workers/webhookWorker";

const globalAny = global as any;

function mockJob(data: { webhookId: string; event: string; payload: any }, attemptsMade = 0) {
  return { data, attemptsMade } as any;
}

describe("webhookWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    globalAny.fetch = jest.fn();
  });

  it("skips delivery when the webhook no longer exists", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue(null);

    const result = await processWebhookDeliveryJob(
      mockJob({ webhookId: "missing", event: "evidence.updated", payload: {} }),
    );

    expect(result).toEqual({ delivered: false, responseCode: null });
    expect(globalAny.fetch).not.toHaveBeenCalled();
  });

  it("skips delivery when the webhook is inactive", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "encrypted-blob",
      isActive: false,
    });

    const result = await processWebhookDeliveryJob(
      mockJob({ webhookId: "wh-1", event: "evidence.updated", payload: {} }),
    );

    expect(result).toEqual({ delivered: false, responseCode: null });
    expect(globalAny.fetch).not.toHaveBeenCalled();
  });

  it("signs and POSTs the payload, records a successful delivery", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "encrypted-blob",
      isActive: true,
    });
    globalAny.fetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await processWebhookDeliveryJob(
      mockJob({ webhookId: "wh-1", event: "evidence.updated", payload: { controlId: "c1" } }),
    );

    expect(result).toEqual({ delivered: true, responseCode: 200 });
    expect(globalAny.fetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-Dharma-Signature-256": expect.stringMatching(/^sha256=/) }),
      }),
    );
    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: "wh-1",
        event: "evidence.updated",
        responseCode: 200,
        success: true,
        attempt: 1,
      }),
    });
  });

  it("records a failed delivery and rethrows so BullMQ retries", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "encrypted-blob",
      isActive: true,
    });
    globalAny.fetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      processWebhookDeliveryJob(
        mockJob({ webhookId: "wh-1", event: "control.failed", payload: {} }, 2),
      ),
    ).rejects.toThrow();

    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false, responseCode: 500, attempt: 3 }),
    });
  });

  it("records a network-error delivery (no response code) and rethrows", async () => {
    mockPrisma.webhook.findUnique.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
      secret: "encrypted-blob",
      isActive: true,
    });
    globalAny.fetch.mockRejectedValue(new Error("network down"));

    await expect(
      processWebhookDeliveryJob(
        mockJob({ webhookId: "wh-1", event: "evidence.updated", payload: {} }),
      ),
    ).rejects.toThrow();

    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false, responseCode: null }),
    });
  });
});
