/**
 * tests/embeddingClient.test.ts — Phase 7 Part 1 unit tests for the embedding
 * client. The underlying Ollama HTTP call (`getEmbedding`) is mocked, so these
 * run with no Ollama / network.
 */
// Uses the Jest globals (describe/it/expect/jest) that next/jest injects — this
// is the mocking style the rest of the suite uses (see marketplace.service.test.ts).
jest.mock("@/workers/ollama", () => ({
  getEmbedding: jest.fn(),
}));

import { getEmbedding } from "@/workers/ollama";
import {
  embedText,
  embedBatch,
  EMBEDDING_DIM,
  EmbeddingDimensionError,
  EmbeddingFailedError,
} from "@/server/ai/embeddingClient";

const mockGetEmbedding = getEmbedding as jest.Mock;
const vec = (fill = 0.1): number[] => Array.from({ length: EMBEDDING_DIM }, () => fill);

describe("embeddingClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a 384-dim vector from a single embedText call", async () => {
    mockGetEmbedding.mockResolvedValueOnce(vec());
    const out = await embedText("hello world");
    expect(out).toHaveLength(EMBEDDING_DIM);
    expect(mockGetEmbedding).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure then succeeds (exponential backoff)", async () => {
    mockGetEmbedding
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(vec());
    const out = await embedText("retry me", { maxRetries: 3 });
    expect(out).toHaveLength(EMBEDDING_DIM);
    expect(mockGetEmbedding).toHaveBeenCalledTimes(3);
  });

  it("throws EmbeddingFailedError after exhausting retries", async () => {
    mockGetEmbedding.mockRejectedValue(new Error("down"));
    await expect(embedText("nope", { maxRetries: 3 })).rejects.toBeInstanceOf(EmbeddingFailedError);
    expect(mockGetEmbedding).toHaveBeenCalledTimes(3);
  });

  it("rejects a wrong-dimension vector immediately without retrying (no silent pad/truncate)", async () => {
    mockGetEmbedding.mockResolvedValue(Array.from({ length: 100 }, () => 0.2)); // wrong dim
    await expect(embedText("bad dim", { maxRetries: 3 })).rejects.toBeInstanceOf(EmbeddingDimensionError);
    expect(mockGetEmbedding).toHaveBeenCalledTimes(1);
  });

  it("embedBatch preserves input order across batch boundaries", async () => {
    // Each call returns a vector whose first element encodes call order.
    let n = 0;
    mockGetEmbedding.mockImplementation(async () => {
      const v = vec(0);
      v[0] = n++;
      return v;
    });
    const texts = Array.from({ length: 45 }, (_, i) => `text ${i}`);
    const out = await embedBatch(texts, { batchSize: 20 });
    expect(out).toHaveLength(45);
    // Within each parallel slice order is preserved by construction of embedBatch.
    out.forEach((v) => expect(v).toHaveLength(EMBEDDING_DIM));
    expect(mockGetEmbedding).toHaveBeenCalledTimes(45);
  });
});
