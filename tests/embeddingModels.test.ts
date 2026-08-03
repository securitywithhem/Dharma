/**
 * Regression guard for the embedding model↔dimension contract.
 *
 * The bug these tests pin: `getEmbedding` used to `slice(0, 384)` whatever the
 * model returned, so configuring a 768-dimension model (which every env file
 * did) produced half-vectors that were stored and searched without a single
 * error being raised. A truncated embedding is not a smaller embedding, so
 * every similarity ranking built on those rows was noise.
 */

import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIM,
  EmbeddingDimensionError,
  assertEmbeddingDimension,
  checkEmbeddingModelCompatibility,
  getEmbeddingModel,
  getKnownDimension,
} from "@/server/ai/embeddingModels";

describe("embedding model registry", () => {
  const original = process.env.OLLAMA_MODEL_EMBEDDING;
  afterEach(() => {
    if (original === undefined) delete process.env.OLLAMA_MODEL_EMBEDDING;
    else process.env.OLLAMA_MODEL_EMBEDDING = original;
  });

  it("defaults to a model whose native dimension matches the schema", () => {
    delete process.env.OLLAMA_MODEL_EMBEDDING;
    expect(getEmbeddingModel()).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(getKnownDimension(DEFAULT_EMBEDDING_MODEL)).toBe(EMBEDDING_DIM);
    expect(checkEmbeddingModelCompatibility().compatible).toBe(true);
  });

  it("rejects nomic-embed-text, the 768-dim model this repo used to ship", () => {
    process.env.OLLAMA_MODEL_EMBEDDING = "nomic-embed-text";
    const result = checkEmbeddingModelCompatibility();
    expect(result.knownDimension).toBe(768);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("768");
    expect(result.reason).toContain(String(EMBEDDING_DIM));
  });

  it("treats an uncatalogued model as unverified rather than broken", () => {
    const result = checkEmbeddingModelCompatibility("some-future-embedder");
    expect(result.knownDimension).toBeNull();
    expect(result.compatible).toBe(true);
  });

  it("accepts a correctly sized vector unchanged", () => {
    const vec = new Array(EMBEDDING_DIM).fill(0.1);
    expect(assertEmbeddingDimension(vec)).toHaveLength(EMBEDDING_DIM);
  });

  it("throws rather than truncating an over-long vector", () => {
    const vec = new Array(768).fill(0.1);
    expect(() => assertEmbeddingDimension(vec, "nomic-embed-text")).toThrow(EmbeddingDimensionError);
    expect(() => assertEmbeddingDimension(vec, "nomic-embed-text")).toThrow(/768/);
  });

  it("throws rather than padding an under-long vector", () => {
    expect(() => assertEmbeddingDimension(new Array(128).fill(0))).toThrow(EmbeddingDimensionError);
  });

  it("rejects a non-array payload", () => {
    expect(() => assertEmbeddingDimension(null)).toThrow(EmbeddingDimensionError);
  });
});
