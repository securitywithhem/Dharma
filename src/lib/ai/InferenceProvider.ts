/**
 * src/lib/ai/InferenceProvider.ts
 *
 * Phase 2 Feature 1 — Pluggable AI inference interface.
 *
 * All workers that need LLM or embedding capabilities should depend on this
 * interface, NOT on a specific implementation (Ollama, OpenAI-compatible, etc.).
 *
 * Provider resolution: see resolveProvider.ts
 */

export interface InferenceProvider {
  /**
   * Summarise a block of text to a single paragraph.
   * Used for evidence classification summaries.
   */
  summarize(text: string): Promise<string>;

  /**
   * Generate a dense vector embedding for the given text.
   * Must return a float32 array with the configured embedding dimensionality (default 384).
   */
  embed(text: string): Promise<number[]>;

  /**
   * Send a structured JSON chat request.
   * The system prompt defines the output schema as a comment or instruction.
   * The implementation MUST parse and return the JSON object, not the raw string.
   * Throws if the model output cannot be parsed as valid JSON.
   */
  chatJSON<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}
