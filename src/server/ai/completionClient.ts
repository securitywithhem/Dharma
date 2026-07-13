/**
 * src/server/ai/completionClient.ts
 *
 * Phase 7 Part 2 — provider-agnostic streaming chat-completion client for the
 * AI Advisor. Mirrors src/server/ai/embeddingClient.ts: same env-var
 * convention (OLLAMA_BASE_URL / OLLAMA_MODEL_LLM, OPENAI_API_KEY opt-in) and
 * the same retry-on-connect approach.
 *
 * Default provider is local Ollama (`/api/chat`, ndjson stream). If
 * OPENAI_API_KEY is set, OpenAI's streaming Chat Completions API is used
 * instead. Neither provider is hard-coded — selection is by env, preserving
 * Dharma's local-first data sovereignty (2_TRD.md §5).
 *
 * Every call returns token `usage`. Ollama reports `prompt_eval_count` /
 * `eval_count`; OpenAI reports a `usage` object (with stream_options). When a
 * provider omits counts we fall back to a `length / 4` heuristic — a rough
 * ~4-chars-per-token approximation, clearly not exact, sufficient for budget
 * accounting.
 */

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface StreamCompletionParams {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Called with each token/delta as it streams in. */
  onToken?: (t: string) => void;
  /** Override the model; defaults to the env LLM model. */
  model?: string;
  /** Retry budget for the initial request (default 2). */
  maxRetries?: number;
}

export interface StreamCompletionResult {
  fullText: string;
  usage: CompletionUsage;
}

/** ~4 chars/token — a deliberate approximation used only when the provider
 * does not report exact counts. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isOpenAIEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
}

function defaultModel(): string {
  if (isOpenAIEnabled()) return process.env.OPENAI_MODEL_LLM ?? "gpt-4o-mini";
  return process.env.OLLAMA_MODEL_LLM ?? "llama3:8b";
}

/** Build the provider message array with the system prompt prepended. */
function withSystem(systemPrompt: string, messages: ChatMessage[]): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...messages];
}

/**
 * Stream a chat completion, invoking `onToken` for each delta. Resolves with
 * the full text and token usage once the stream completes.
 */
export async function streamCompletion(params: StreamCompletionParams): Promise<StreamCompletionResult> {
  const maxRetries = params.maxRetries ?? 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return isOpenAIEnabled() ? await streamOpenAI(params) : await streamOllama(params);
    } catch (err) {
      lastErr = err;
      console.warn(`[ai-completion] attempt ${attempt}/${maxRetries} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < maxRetries) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Chat completion failed after ${maxRetries} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

// ---------------------------------------------------------------------------
// Ollama — POST /api/chat, ndjson stream
// ---------------------------------------------------------------------------

async function streamOllama(params: StreamCompletionParams): Promise<StreamCompletionResult> {
  const model = params.model ?? defaultModel();
  const body = {
    model,
    messages: withSystem(params.systemPrompt, params.messages),
    stream: true,
    options: { temperature: 0.2 },
  };

  const res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  await consumeLines(res.body, (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let json: any;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return; // ignore partial/non-JSON keep-alive lines
    }
    const delta: string = json?.message?.content ?? "";
    if (delta) {
      fullText += delta;
      params.onToken?.(delta);
    }
    if (json?.done) {
      if (typeof json.prompt_eval_count === "number") promptTokens = json.prompt_eval_count;
      if (typeof json.eval_count === "number") completionTokens = json.eval_count;
    }
  });

  const promptText = body.messages.map((m) => m.content).join("\n");
  return {
    fullText,
    usage: {
      promptTokens: promptTokens || estimateTokens(promptText),
      completionTokens: completionTokens || estimateTokens(fullText),
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI — POST /v1/chat/completions, SSE stream
// ---------------------------------------------------------------------------

async function streamOpenAI(params: StreamCompletionParams): Promise<StreamCompletionResult> {
  const model = params.model ?? defaultModel();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const body = {
    model,
    messages: withSystem(params.systemPrompt, params.messages),
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.2,
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenAI chat ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;

  await consumeLines(res.body, (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta: string = json?.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      fullText += delta;
      params.onToken?.(delta);
    }
    if (json?.usage) {
      promptTokens = json.usage.prompt_tokens ?? promptTokens;
      completionTokens = json.usage.completion_tokens ?? completionTokens;
    }
  });

  const promptText = body.messages.map((m) => m.content).join("\n");
  return {
    fullText,
    usage: {
      promptTokens: promptTokens || estimateTokens(promptText),
      completionTokens: completionTokens || estimateTokens(fullText),
    },
  };
}

// ---------------------------------------------------------------------------
// Shared: read a web ReadableStream line-by-line
// ---------------------------------------------------------------------------

async function consumeLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
