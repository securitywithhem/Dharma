/**
 * src/lib/ai/resolveProvider.ts
 *
 * Phase 2 Feature 1 — Per-org AI provider resolver.
 *
 * Reads the org's `aiProvider` JSON config from the database and returns
 * the correct InferenceProvider implementation.
 *
 * aiProvider JSON shape:
 *   { mode: "local-ollama" }
 *   { mode: "local-small", model: "phi3:mini" }
 *   { mode: "remote-opt-in", baseUrl: "...", model: "...", encryptedApiKey: "..." }
 *
 * All three modes maintain data sovereignty — no credentials are ever sent to
 * a cloud service unless the admin explicitly configures "remote-opt-in".
 *
 * Providers are cached per-org per-process to avoid DB round-trips on every job.
 */

import type { InferenceProvider } from "./InferenceProvider";
import { OllamaProvider } from "./OllamaProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";
import { decryptCredential } from "@/lib/crypto/credentials";

// ------------------------------------------------------------------
// aiProvider config type
// ------------------------------------------------------------------

type OllamaMode = {
  mode: "local-ollama";
  model?: string;
  embeddingModel?: string;
};

type LocalSmallMode = {
  mode: "local-small";
  baseUrl?: string; // default: http://localhost:11434/v1
  model: string;   // e.g. "phi3:mini"
};

type RemoteOptInMode = {
  mode: "remote-opt-in";
  baseUrl: string;
  model: string;
  encryptedApiKey: string; // AES-256-GCM via credentials.ts
};

type AiProviderConfig = OllamaMode | LocalSmallMode | RemoteOptInMode;

// ------------------------------------------------------------------
// Per-process cache
// ------------------------------------------------------------------

const providerCache = new Map<string, InferenceProvider>();

/**
 * Resolve the InferenceProvider for a given organization.
 *
 * Falls back to OllamaProvider (using OLLAMA_BASE_URL env var) if the org
 * has no aiProvider config stored — maintains backward compatibility with
 * all Phase 0 / Phase 1 deployments.
 */
export async function resolveInferenceProvider(
  prisma: { organization: { findUnique: (args: { where: { id: string }; select: { aiProvider: boolean } }) => Promise<{ aiProvider: unknown } | null> } },
  organizationId: string,
): Promise<InferenceProvider> {
  if (providerCache.has(organizationId)) {
    return providerCache.get(organizationId)!;
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiProvider: true },
  });

  const raw = org?.aiProvider as AiProviderConfig | null;

  let provider: InferenceProvider;

  if (!raw || raw.mode === "local-ollama") {
    const config = raw as OllamaMode | null;
    provider = new OllamaProvider(
      process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      config?.model ?? process.env.OLLAMA_MODEL_LLM ?? "llama3:8b",
      config?.embeddingModel ?? process.env.OLLAMA_MODEL_EMBEDDING ?? "nomic-embed-text",
    );
  } else if (raw.mode === "local-small") {
    const baseUrl = raw.baseUrl ?? `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1`;
    provider = new OpenAICompatibleProvider({
      baseUrl,
      model: raw.model,
      apiKey: "ollama",
    });
  } else if (raw.mode === "remote-opt-in") {
    let apiKey: string;
    try {
      apiKey = decryptCredential(raw.encryptedApiKey);
    } catch (err) {
      console.error(
        `[resolveProvider] Failed to decrypt API key for org ${organizationId} — falling back to OllamaProvider:`,
        err,
      );
      provider = new OllamaProvider();
      providerCache.set(organizationId, provider);
      return provider;
    }
    provider = new OpenAICompatibleProvider({
      baseUrl: raw.baseUrl,
      model: raw.model,
      apiKey,
    });
  } else {
    // Unknown mode — safe fallback
    console.warn(`[resolveProvider] Unknown mode "${(raw as AiProviderConfig).mode}" for org ${organizationId} — using Ollama`);
    provider = new OllamaProvider();
  }

  providerCache.set(organizationId, provider);
  return provider;
}

/**
 * Invalidate the per-org provider cache after a settings update.
 * Called from the settings router after updateAIConfig.
 */
export function invalidateProviderCache(organizationId: string): void {
  providerCache.delete(organizationId);
}
