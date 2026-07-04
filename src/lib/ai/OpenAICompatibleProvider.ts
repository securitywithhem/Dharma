/**
 * src/lib/ai/OpenAICompatibleProvider.ts
 *
 * Phase 2 Feature 1 — Generic OpenAI-compatible chat completion provider.
 *
 * Works with:
 *   - A local quantized model served via Ollama's OpenAI-compatible API (/v1/chat/completions)
 *   - Remote cloud endpoints (Azure OpenAI, AWS Bedrock proxy, Fireworks, etc.)
 *
 * The API key is expected to be already-decrypted before being passed here.
 * Decryption from DB happens in resolveProvider.ts.
 *
 * Embedding: this provider uses Ollama for embeddings (compatible with existing 384-dim vectors).
 * If the remote endpoint supports /v1/embeddings you can subclass and override embed().
 */

import type { InferenceProvider } from "./InferenceProvider";
import { getEmbedding } from "@/workers/ollama";

export class OpenAICompatibleProvider implements InferenceProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly embeddingBaseUrl: string;
  private readonly embeddingModel: string;

  constructor(options: {
    baseUrl: string;          // e.g. "http://localhost:11434/v1" or "https://api.openai.com/v1"
    model: string;            // e.g. "phi3:mini" or "gpt-4o-mini"
    apiKey?: string;          // optional — some local servers don't require auth
    embeddingBaseUrl?: string; // falls back to OLLAMA_BASE_URL for embeddings
    embeddingModel?: string;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey ?? "ollama"; // Ollama's OpenAI adapter accepts any non-empty key
    this.embeddingBaseUrl = options.embeddingBaseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.embeddingModel = options.embeddingModel ?? "nomic-embed-text";
  }

  private async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[OpenAICompatibleProvider] ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return content;
  }

  async summarize(text: string): Promise<string> {
    return this.chat([
      {
        role: "system",
        content:
          "You are a compliance assistant. Summarise the following evidence in one concise paragraph (max 120 words). Focus on security-relevant facts. Output only the paragraph.",
      },
      { role: "user", content: text.slice(0, 2000) },
    ]);
  }

  async embed(text: string): Promise<number[]> {
    // Re-use the local Ollama embedding model for consistency with existing pgvector columns
    return getEmbedding(text, this.embeddingModel);
  }

  async chatJSON<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const raw = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const match = raw.match(/[\[{][\s\S]*[\]}]/);
    if (!match) {
      throw new Error(
        `[OpenAICompatibleProvider] Could not extract JSON from response: ${raw.slice(0, 300)}`,
      );
    }
    return JSON.parse(match[0]) as T;
  }
}
