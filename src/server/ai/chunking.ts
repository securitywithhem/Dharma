/**
 * src/server/ai/chunking.ts
 *
 * Phase 7 Part 1 — document chunking for the AI Advisor ingestion pipeline.
 *
 * Splits a document into overlapping, sentence-boundary-aware chunks sized for
 * the 384-dim embedding model. Token counts are ESTIMATED at ~4 chars/token
 * (the standard rough heuristic) — we deliberately avoid pulling in a real BPE
 * tokenizer dependency for this, since chunk sizing only needs to be
 * approximately right and the embedding model truncates internally anyway.
 *
 * Rules:
 *  - Never split mid-sentence, UNLESS a single sentence alone exceeds
 *    `maxTokens` (then it is hard-split on character boundaries).
 *  - Consecutive chunks overlap by ~`overlapTokens` tokens of trailing
 *    sentences, so a fact that straddles a boundary is retrievable from either
 *    side.
 *  - Empty / whitespace-only input yields an empty array.
 */

export interface Chunk {
  /** 0-based position of this chunk within the document. */
  index: number;
  /** The chunk text. */
  content: string;
  /** Estimated token count (~4 chars/token). */
  tokenEstimate: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 50;

/** Rough token estimate for a string. */
export function estimateTokens(text: string): number {
  const len = text.trim().length;
  return len === 0 ? 0 : Math.ceil(len / CHARS_PER_TOKEN);
}

/**
 * Split text into sentences, paragraph-aware. Paragraph breaks (blank lines)
 * are treated as hard sentence boundaries so we never merge across them.
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    // Match runs of non-terminators ending in . ! ? (plus trailing quotes/
    // brackets), or a trailing fragment with no terminator.
    const parts = trimmed.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [trimmed];
    for (const part of parts) {
      const s = part.trim();
      if (s) sentences.push(s);
    }
  }
  return sentences;
}

/** Hard-split a single oversized sentence on character boundaries. */
function hardSplit(sentence: string, maxTokens: number): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const pieces: string[] = [];
  for (let i = 0; i < sentence.length; i += maxChars) {
    pieces.push(sentence.slice(i, i + maxChars).trim());
  }
  return pieces.filter(Boolean);
}

/**
 * Chunk a document into overlapping, sentence-aware windows.
 */
export function chunkDocument(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = Math.max(1, opts.maxTokens ?? DEFAULT_MAX_TOKENS);
  // Overlap must stay strictly below maxTokens to guarantee forward progress.
  const overlapTokens = Math.min(
    Math.max(0, opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS),
    maxTokens - 1,
  );

  if (!text || !text.trim()) return [];

  // Break into atomic units: whole sentences, or hard-split pieces of any
  // sentence that is itself larger than a chunk.
  const units: string[] = [];
  for (const sentence of splitIntoSentences(text)) {
    if (estimateTokens(sentence) > maxTokens) {
      units.push(...hardSplit(sentence, maxTokens));
    } else {
      units.push(sentence);
    }
  }

  const chunkTexts: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunkTexts.push(current.join(" "));
    // Seed the next window with trailing units summing to ~overlapTokens.
    const overlap: string[] = [];
    let overlapAcc = 0;
    for (let k = current.length - 1; k >= 0; k--) {
      const t = estimateTokens(current[k]);
      if (overlapAcc + t > overlapTokens) break;
      overlap.unshift(current[k]);
      overlapAcc += t;
    }
    current = overlap;
    currentTokens = overlapAcc;
  };

  for (const unit of units) {
    const t = estimateTokens(unit);
    if (currentTokens + t > maxTokens && current.length > 0) {
      flush();
    }
    current.push(unit);
    currentTokens += t;
  }
  if (current.length > 0) {
    chunkTexts.push(current.join(" "));
  }

  return chunkTexts.map((content, index) => ({
    index,
    content,
    tokenEstimate: estimateTokens(content),
  }));
}
