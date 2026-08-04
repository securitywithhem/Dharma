/**
 * src/server/ai/advisorHealth.ts
 *
 * Readiness probe for the AI Advisor, distinct from `health.checkAll`.
 *
 * `health.checkAll` answers "is the Ollama process reachable" — which was not
 * enough. The advisor can be reachable and still guaranteed to fail, in two
 * ways that both used to surface only as a raw stack trace at send-time:
 *
 *   1. The configured embedding model is not pulled. Ollama answers /api/tags
 *      happily; the embed call then 404s per request.
 *   2. The configured embedding model emits a different number of dimensions
 *      than the schema's vector(384) columns.
 *
 * Both are checked here so the chat panel can render a degraded state up front
 * instead of inviting the user to type into a request that cannot succeed.
 */

import {
  checkEmbeddingModelCompatibility,
  getEmbeddingModel,
  type EmbeddingModelCompatibility,
} from "@/server/ai/embeddingModels";

export type AdvisorHealthReason = "UNREACHABLE" | "MODEL_MISSING" | "DIMENSION_MISMATCH";

export interface AdvisorHealth {
  healthy: boolean;
  /** The embedding model this deployment is configured to use. */
  model: string;
  /** Machine-readable cause, absent when healthy. */
  reason?: AdvisorHealthReason;
  /** Copy safe to show a user verbatim — never contains a stack trace. */
  message?: string;
  /** Model↔schema dimension contract, for operator-facing detail. */
  compatibility: EmbeddingModelCompatibility;
}

/** Ollama tags a pulled model as e.g. "all-minilm:latest" — match on the base name too. */
function hasModel(installed: string[], model: string): boolean {
  const base = model.split(":")[0];
  return installed.some((m) => m === model || m.split(":")[0] === base);
}

/**
 * Probe the advisor's embedding dependency. Never throws: a health check that
 * can fail is not a health check.
 */
export async function checkAdvisorHealth(
  baseUrl: string = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
): Promise<AdvisorHealth> {
  const model = getEmbeddingModel();
  const compatibility = checkEmbeddingModelCompatibility(model);

  // A dimension mismatch is fatal regardless of reachability — checking it
  // first means a misconfigured deployment says so even while Ollama is down.
  if (!compatibility.compatible) {
    console.error(`[ai-advisor] embedding model misconfigured: ${compatibility.reason}`);
    return {
      healthy: false,
      model,
      reason: "DIMENSION_MISMATCH",
      message:
        "The AI assistant is misconfigured and has been disabled to avoid storing unusable data. An administrator needs to review the embedding model setting.",
      compatibility,
    };
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return {
        healthy: false,
        model,
        reason: "UNREACHABLE",
        message: "The AI assistant is temporarily unavailable — try again shortly.",
        compatibility,
      };
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const installed = (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);

    if (!hasModel(installed, model)) {
      console.error(
        `[ai-advisor] embedding model "${model}" is not pulled on ${baseUrl}. Installed: ${installed.join(", ") || "(none)"}`,
      );
      return {
        healthy: false,
        model,
        reason: "MODEL_MISSING",
        message:
          "The AI assistant is still setting up its language model. This usually resolves within a few minutes of first start-up.",
        compatibility,
      };
    }

    return { healthy: true, model, compatibility };
  } catch (err) {
    // Raw cause stays server-side; the user gets the friendly line above.
    console.error(`[ai-advisor] health probe against ${baseUrl} failed:`, err);
    return {
      healthy: false,
      model,
      reason: "UNREACHABLE",
      message: "The AI assistant is temporarily unavailable — try again shortly.",
      compatibility,
    };
  }
}
