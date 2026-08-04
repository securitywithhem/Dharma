/**
 * src/server/ai/embeddingClient.ts
 *
 * Phase 7 Part 1 — provider-agnostic embedding client for the AI Advisor
 * ingestion pipeline.
 *
 * This is a thin, retry-aware wrapper over the existing Phase 2 inference
 * stack (src/lib/ai/*, src/workers/ollama.ts). It does NOT open a second HTTP
 * path to Ollama/OpenAI — it reuses `getEmbedding` directly, or an org's
 * resolved `InferenceProvider` when a per-org config exists. This keeps every
 * embedding in Dharma at the same dimensionality and honours the per-org
 * data-sovereignty rules (embeddings per org, no external network calls).
 *
 * Dimension is 384 to match Control/Evidence/Vulnerability/RegulationSnippet
 * columns. The client REJECTS any vector whose length ≠ 384 rather than
 * padding/truncating — a dimension mismatch is a configuration bug, not
 * something to paper over.
 *
 * That guard was previously unreachable: `getEmbedding` truncated with
 * `slice(0, 384)` before this code ever saw the vector, so a misconfigured
 * 768-dim model produced garbage embeddings instead of an error. The model /
 * dimension contract now lives in `embeddingModels.ts`.
 */

import { getEmbedding } from "@/workers/ollama";
import { resolveInferenceProvider } from "@/lib/ai/resolveProvider";
import {
  EMBEDDING_DIM,
  EmbeddingDimensionError,
  getEmbeddingModel,
} from "@/server/ai/embeddingModels";

// Re-exported so existing importers of these symbols keep working; the
// definitions live in embeddingModels.ts, which owns the model↔dimension
// contract and has no dependency on the HTTP client.
export { EMBEDDING_DIM, EmbeddingDimensionError };

/** Default number of chunks embedded per slice — bounds concurrent load on a
 * single local Ollama instance so large documents don't time it out. */
const DEFAULT_BATCH_SIZE = 20;

/** Default retry budget per individual embedding call. */
const DEFAULT_MAX_RETRIES = 3;

// Resolved per call rather than at module load so tests (and a worker whose
// env is set after import) see the current value.
const embeddingModel = () => getEmbeddingModel();

/** Minimal prisma surface needed to resolve a per-org provider. */
type ProviderPrisma = Parameters<typeof resolveInferenceProvider>[0];

export interface EmbedOptions {
  /** When set (with `prisma`), embeddings use the org's configured provider. */
  organizationId?: string;
  prisma?: ProviderPrisma;
  /** Per-call retry budget (default 3). */
  maxRetries?: number;
  /** Chunks embedded concurrently per slice in embedBatch (default 20). */
  batchSize?: number;
}

/** Thrown after all retries for a single embedding call are exhausted. */
export class EmbeddingFailedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingFailedError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the embed function for this call. Falls back to the default Ollama
 * model when no org/prisma is supplied — keeps unit tests and ad-hoc callers
 * simple while still supporting per-org providers in the worker.
 */
async function resolveEmbedFn(opts: EmbedOptions): Promise<(text: string) => Promise<number[]>> {
  if (opts.organizationId && opts.prisma) {
    const provider = await resolveInferenceProvider(opts.prisma, opts.organizationId);
    return (text: string) => provider.embed(text);
  }
  return (text: string) => getEmbedding(text, embeddingModel());
}

/**
 * Embed a single string with exponential-backoff retry.
 *
 * Backoff: 500ms, 1000ms, 2000ms … (doubling). Structured `console.warn`
 * logging on each retry; the caller (the ingestion worker) is responsible for
 * writing the `ai_ingestion.failed` audit event on final failure, since only
 * it holds the org/user/document context.
 */
export async function embedText(text: string, opts: EmbedOptions = {}): Promise<number[]> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const embedFn = await resolveEmbedFn(opts);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const vec = await embedFn(text);
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
        // A dimension mismatch is not retryable — it's a misconfigured model.
        throw new EmbeddingDimensionError(Array.isArray(vec) ? vec.length : -1, embeddingModel());
      }
      return vec;
    } catch (err) {
      if (err instanceof EmbeddingDimensionError) throw err;
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ai-embedding] attempt ${attempt}/${maxRetries} failed${opts.organizationId ? ` (org ${opts.organizationId})` : ""}: ${message}`,
      );
      if (attempt < maxRetries) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }
  throw new EmbeddingFailedError(
    `Embedding failed after ${maxRetries} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    lastErr,
  );
}

/**
 * Embed many strings, processed in slices of `batchSize` (default 20). Items
 * within a slice run concurrently; slices run sequentially so a large document
 * never fires hundreds of simultaneous requests at a single Ollama instance.
 * Order is preserved: `result[i]` is the embedding of `texts[i]`.
 */
export async function embedBatch(texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const out: number[][] = new Array(texts.length);

  for (let start = 0; start < texts.length; start += batchSize) {
    const slice = texts.slice(start, start + batchSize);
    const embedded = await Promise.all(slice.map((t) => embedText(t, opts)));
    for (let j = 0; j < embedded.length; j++) {
      out[start + j] = embedded[j];
    }
  }
  return out;
}
