/**
 * src/server/ai/embeddingModels.ts
 *
 * Single source of truth for "which embedding model do we run, and how many
 * dimensions does it emit".
 *
 * WHY THIS EXISTS (deviation worth documenting, per Coding_Standards.md):
 * every pgvector column in this schema is `vector(384)` — Control.embedding,
 * Evidence.embedding, Vulnerability.embedding, RegulationSnippet.embedding,
 * OrganizationEmbedding.embedding. Until this module landed, every env file
 * and the docker-compose default configured `nomic-embed-text`, which emits
 * **768** dimensions, and `getEmbedding()` reconciled the difference with
 * `embedding.slice(0, 384)`.
 *
 * Truncating an embedding to its first half is not a smaller embedding — it is
 * a different, meaningless vector. Cosine similarity computed over half a
 * nomic vector does not approximate similarity over the whole one, so every
 * RAG retrieval, cross-walk suggestion, and evidence auto-tag built on those
 * rows was ranking on noise. The failure was silent: nothing ever threw.
 *
 * The fix is to make dimension a property of the model we can assert on,
 * default to a model that genuinely emits 384 (`all-minilm`), and treat a
 * mismatch as a configuration error surfaced at health-check time rather than
 * something papered over at call time.
 */

/** The single embedding dimension used across all Dharma pgvector columns. */
export const EMBEDDING_DIM = 384;

/**
 * Output dimensions of the embedding models we support on Ollama.
 *
 * Only models whose dimension we have verified belong here. An unlisted model
 * is not rejected — it is simply unverifiable ahead of time, so it falls back
 * to the runtime length check in `embeddingClient.embedText`.
 */
export const EMBEDDING_MODEL_DIMENSIONS: Readonly<Record<string, number>> = Object.freeze({
  "all-minilm": 384,
  "all-minilm:l6-v2": 384,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "bge-m3": 1024,
});

/**
 * The model used when `OLLAMA_MODEL_EMBEDDING` is unset. Chosen because it is
 * the only widely-available Ollama embedding model whose native output
 * dimension equals `EMBEDDING_DIM`, so no reshaping is ever required.
 */
export const DEFAULT_EMBEDDING_MODEL = "all-minilm";

/** The embedding model this process is configured to use. */
export function getEmbeddingModel(): string {
  return process.env.OLLAMA_MODEL_EMBEDDING || DEFAULT_EMBEDDING_MODEL;
}

/** Known output dimension for `model`, or `null` when we have not verified it. */
export function getKnownDimension(model: string): number | null {
  return EMBEDDING_MODEL_DIMENSIONS[model] ?? null;
}

/** Thrown when a provider returns a vector of the wrong dimensionality. */
export class EmbeddingDimensionError extends Error {
  constructor(
    readonly actual: number,
    readonly model: string = getEmbeddingModel(),
  ) {
    super(
      `Embedding model "${model}" returned a ${actual}-dimension vector; this schema stores ` +
        `vector(${EMBEDDING_DIM}). Refusing to pad or truncate — a half-vector is not a smaller ` +
        `embedding, it is a meaningless one. Set OLLAMA_MODEL_EMBEDDING to a ${EMBEDDING_DIM}-` +
        `dimension model (e.g. "${DEFAULT_EMBEDDING_MODEL}").`,
    );
    this.name = "EmbeddingDimensionError";
  }
}

/**
 * Throw unless `vec` is a usable `EMBEDDING_DIM`-wide vector. Call this before
 * any write to a pgvector column so the failure names the misconfigured model
 * rather than surfacing as an opaque Postgres type error.
 */
export function assertEmbeddingDimension(vec: unknown, model: string = getEmbeddingModel()): number[] {
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    throw new EmbeddingDimensionError(Array.isArray(vec) ? vec.length : -1, model);
  }
  return vec as number[];
}

export interface EmbeddingModelCompatibility {
  model: string;
  /** Dimension the schema requires. */
  expectedDimension: number;
  /** Dimension the model emits, or null when unverified. */
  knownDimension: number | null;
  /**
   * false only when we KNOW the model's dimension and it disagrees with the
   * schema. An unverified model is reported as compatible-but-unverified so a
   * user running a valid model we simply have not catalogued is not blocked.
   */
  compatible: boolean;
  /** Operator-facing explanation, present only when `compatible` is false. */
  reason?: string;
}

/**
 * Check the configured model against the schema's vector width. Used by the
 * advisor health check so a misconfiguration shows up as a clear banner rather
 * than as silently degraded answers.
 */
export function checkEmbeddingModelCompatibility(
  model: string = getEmbeddingModel(),
): EmbeddingModelCompatibility {
  const knownDimension = getKnownDimension(model);
  if (knownDimension === null) {
    return { model, expectedDimension: EMBEDDING_DIM, knownDimension: null, compatible: true };
  }
  if (knownDimension === EMBEDDING_DIM) {
    return { model, expectedDimension: EMBEDDING_DIM, knownDimension, compatible: true };
  }
  return {
    model,
    expectedDimension: EMBEDDING_DIM,
    knownDimension,
    compatible: false,
    reason:
      `Embedding model "${model}" emits ${knownDimension}-dimension vectors, but every pgvector ` +
      `column in this schema is vector(${EMBEDDING_DIM}). Set OLLAMA_MODEL_EMBEDDING to a ` +
      `${EMBEDDING_DIM}-dimension model (e.g. "${DEFAULT_EMBEDDING_MODEL}"), or migrate the ` +
      `vector columns to vector(${knownDimension}) and re-generate every stored embedding.`,
  };
}
