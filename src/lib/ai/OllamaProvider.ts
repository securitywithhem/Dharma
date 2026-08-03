/**
 * src/lib/ai/OllamaProvider.ts
 *
 * Phase 2 Feature 1 — Ollama implementation of InferenceProvider.
 * Wraps the existing ollama.ts HTTP helpers.
 */

import type { InferenceProvider } from "./InferenceProvider";
import { getEmbedding, generateText } from "@/workers/ollama";
import { getEmbeddingModel } from "@/server/ai/embeddingModels";

export class OllamaProvider implements InferenceProvider {
  private readonly baseUrl: string;
  private readonly llmModel: string;
  private readonly embeddingModel: string;

  constructor(
    baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    llmModel = process.env.OLLAMA_MODEL_LLM ?? "llama3:8b",
    embeddingModel = getEmbeddingModel(),
  ) {
    this.baseUrl = baseUrl;
    this.llmModel = llmModel;
    this.embeddingModel = embeddingModel;
  }

  async summarize(text: string): Promise<string> {
    const prompt =
      `Summarise the following compliance evidence in one concise paragraph (max 120 words). ` +
      `Focus on security-relevant facts. Output only the paragraph, no preamble.\n\n${text.slice(0, 2000)}`;
    return generateText(prompt, this.llmModel);
  }

  async embed(text: string): Promise<number[]> {
    return getEmbedding(text, this.embeddingModel);
  }

  async chatJSON<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const combined = `${systemPrompt}\n\n${userPrompt}`;
    const raw = await generateText(combined, this.llmModel);
    // Extract JSON from the response
    const match = raw.match(/[\[{][\s\S]*[\]}]/);
    if (!match) {
      throw new Error(`[OllamaProvider] Could not parse JSON from model output: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(match[0]) as T;
  }
}
