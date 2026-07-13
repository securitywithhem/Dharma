/**
 * src/server/ai/advisorService.ts
 *
 * Phase 7 Part 2 — orchestration for one AI Advisor chat turn. Kept out of the
 * tRPC router so it can be driven directly in tests with injected retrieval /
 * completion (no Ollama/pgvector needed). The router is a thin wrapper.
 *
 * Turn flow (6_IMPLEMENTATION_PLAN.md tasks 3–4, 6; 3_APP_FLOW.md §5):
 *   rate-limit → monthly-budget → load/create session → retrieve context →
 *   detect intent → guardrail (force fallback on insufficient context) →
 *   compose prompt → stream completion → validate output scope →
 *   persist messages → record token usage.
 */

import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { createAuditLog } from "@/server/audit-log";
import { retrieveContext, type RetrievedContext } from "@/server/ai/retrieval";
import { streamCompletion, type ChatMessage, type StreamCompletionResult } from "@/server/ai/completionClient";
import {
  SYSTEM_PROMPT,
  INSUFFICIENT_CONTEXT_ANSWER,
  composeUserPrompt,
  buildGapAssessmentPrompt,
  buildPolicyDraftPrompt,
  detectIntent,
  hasInsufficientContext,
  validateOutputScope,
  type AdvisorIntent,
} from "@/server/ai/promptTemplates";
import { enforceAiRateLimit, enforceMonthlyBudget, recordUsage } from "@/server/ai/usageLimits";

export interface AdvisorTurnInput {
  organizationId: string;
  userId: string;
  sessionId?: string;
  message: string;
  /** Optional token callback for future streaming transports (Part 3). */
  onToken?: (t: string) => void;
}

export interface AdvisorCitation {
  type: "chunk" | "control";
  id: string;
}

export interface StoredTurn {
  role: "user" | "assistant";
  content: string;
  citations?: AdvisorCitation[];
}

export interface AdvisorTurnResult {
  sessionId: string;
  message: string;
  intent: string;
  usage: { promptTokens: number; completionTokens: number };
  citations: AdvisorCitation[];
  flagged: boolean;
  insufficientContext: boolean;
  /** Phase 7 Part 3 (additive) — source names shown in the UI ContextBar. */
  contextSummary: string[];
}

/** Injectable dependencies — real implementations by default. */
export interface AdvisorDeps {
  retrieve?: (organizationId: string, query: string) => Promise<RetrievedContext>;
  stream?: (params: {
    systemPrompt: string;
    messages: ChatMessage[];
    onToken?: (t: string) => void;
  }) => Promise<StreamCompletionResult>;
}

const CITATION_RE = /\[\[(chunk|control):([^\]]+)\]\]/g;

/** Parse inline [[chunk:ID]] / [[control:ID]] markers into structured citations. */
export function parseCitations(text: string): AdvisorCitation[] {
  const out: AdvisorCitation[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CITATION_RE)) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ type: m[1] as "chunk" | "control", id: m[2].trim() });
    }
  }
  return out;
}

/** Map stored session turns to provider ChatMessages (history for context). */
function historyToMessages(messages: StoredTurn[]): ChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
}

function composePromptForIntent(message: string, context: RetrievedContext): { prompt: string; intent: AdvisorIntent } {
  const intent = detectIntent(message);
  if (intent === "gap_assessment") {
    const frameworkName = context.liveControls[0]?.frameworkName;
    if (frameworkName) return { prompt: buildGapAssessmentPrompt(frameworkName, context), intent };
  }
  if (intent === "policy_draft") {
    return { prompt: buildPolicyDraftPrompt(message, context), intent };
  }
  return { prompt: composeUserPrompt(message, context), intent };
}

/**
 * Execute one chat turn. Returns the assistant message plus metadata; persists
 * the conversation and usage as side effects.
 */
export async function runAdvisorTurn(
  prisma: PrismaClient,
  input: AdvisorTurnInput,
  deps: AdvisorDeps = {},
): Promise<AdvisorTurnResult> {
  const { organizationId, userId } = input;

  // 1. Limits — enforced before any expensive work.
  enforceAiRateLimit(organizationId);
  await enforceMonthlyBudget(prisma, organizationId);

  // 2. Session — load (org + user scoped) or create.
  let session = input.sessionId
    ? await prisma.aIAdvisorSession.findFirst({ where: { id: input.sessionId, organizationId, userId } })
    : null;
  if (input.sessionId && !session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Advisor session not found." });
  }
  if (!session) {
    session = await prisma.aIAdvisorSession.create({
      data: { organizationId, userId, messages: [] },
    });
  }
  const history: StoredTurn[] = Array.isArray(session.messages) ? (session.messages as unknown as StoredTurn[]) : [];

  // 3. Retrieve org-scoped context.
  const retrieve = deps.retrieve ?? ((org: string, q: string) => retrieveContext(prisma, org, q));
  const context = await retrieve(organizationId, input.message);

  // 4. Guardrail: force the fixed fallback when retrieval has no usable signal.
  let assistantText: string;
  let usage = { promptTokens: 0, completionTokens: 0 };
  let intent = detectIntent(input.message);
  const insufficient = hasInsufficientContext(context);

  if (insufficient) {
    assistantText = INSUFFICIENT_CONTEXT_ANSWER;
  } else {
    const composed = composePromptForIntent(input.message, context);
    intent = composed.intent;
    const messages: ChatMessage[] = [...historyToMessages(history), { role: "user", content: composed.prompt }];
    const stream = deps.stream ?? streamCompletion;
    const result = await stream({ systemPrompt: SYSTEM_PROMPT, messages, onToken: input.onToken });
    assistantText = result.fullText;
    usage = result.usage;
  }

  // 5. Output-scope validation — flag (never rewrite); audit-log violations.
  const scope = validateOutputScope(assistantText);
  if (scope.flagged) {
    await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "AI_ADVISOR_SCOPE_FLAGGED",
      entity: "AIAdvisorSession",
      entityId: session.id,
      changes: { reasons: scope.reasons },
    }).catch((e) => console.error("[ai-advisor] failed to audit scope violation:", e));
  }

  // 6. Persist both turns.
  const citations = parseCitations(assistantText);
  const updatedMessages: StoredTurn[] = [
    ...history,
    { role: "user", content: input.message },
    { role: "assistant", content: assistantText, citations },
  ];
  await prisma.aIAdvisorSession.update({
    where: { id: session.id },
    data: { messages: updatedMessages as unknown as object },
  });

  // 7. Record token usage for budget accounting.
  await recordUsage(prisma, {
    organizationId,
    userId,
    sessionId: session.id,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  });

  const contextSummary = Array.from(
    new Set([
      ...(context.sources?.documents ?? []),
      ...(context.sources?.frameworks ?? context.liveControls.map((c) => c.frameworkName).filter(Boolean)),
    ]),
  );

  return {
    sessionId: session.id,
    message: assistantText,
    intent,
    usage,
    citations,
    flagged: scope.flagged,
    insufficientContext: insufficient,
    contextSummary,
  };
}
