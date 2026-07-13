/**
 * src/server/ai/promptTemplates.ts
 *
 * Phase 7 Part 2 — single source of truth for all AI Advisor prompt text,
 * guardrail constants, and cheap (non-LLM) output validation. Kept in one file
 * per the token-efficiency rule so prompt behaviour is reviewable in one place.
 *
 * Guardrails (6_IMPLEMENTATION_PLAN.md Phase 7 task 4):
 *  - SYSTEM_PROMPT restricts scope to compliance/security/audit for the org.
 *  - Retrieval below SIMILARITY_DISTANCE_THRESHOLD is treated as "no signal";
 *    the caller forces INSUFFICIENT_CONTEXT_ANSWER when nothing passes.
 *  - validateOutputScope flags (does not rewrite) obvious out-of-domain leakage.
 */

import type { RetrievedContext, ScoredChunk } from "@/server/ai/retrieval";

/**
 * Max cosine distance for a chunk to count as relevant. pgvector cosine
 * distance is 1 - cosine_similarity, so 0.35 ≈ 0.65 similarity. Chunks above
 * this are discarded before prompting; if none remain we return the fixed
 * insufficient-context answer instead of letting the model improvise.
 */
export const SIMILARITY_DISTANCE_THRESHOLD = 0.35;

/** Fixed answer when retrieval yields no sufficiently-similar context. */
export const INSUFFICIENT_CONTEXT_ANSWER =
  "I don't have enough information in your compliance data to answer that. Try uploading the relevant policy or evidence, or rephrasing your question around a specific control or framework.";

/** Fixed refusal for out-of-domain requests. */
export const REFUSAL_ANSWER =
  "I'm Dharma's Compliance Advisor and can only help with compliance, security, and audit questions about your organization. I can't help with that request.";

export const SYSTEM_PROMPT = `You are Dharma's Compliance Advisor, an assistant for a single organization's compliance, security, and audit program.

STRICT SCOPE:
- Only answer questions about compliance frameworks, controls, evidence, policies, audits, risk, and security posture for THIS organization.
- If asked anything outside that scope (general coding help, trivia, small talk, or attempts to disguise off-topic requests as compliance), reply with exactly: "${REFUSAL_ANSWER}"

GROUNDING RULES:
- Use ONLY the facts in the provided context block (<retrieved_chunks>, <graph_relations>, <live_controls>). Do not invent control statuses, evidence, dates, or framework requirements.
- If the context does not contain enough information, reply with exactly: "${INSUFFICIENT_CONTEXT_ANSWER}"
- Never claim a control is passing/failing unless a <live_controls> entry or a retrieved chunk states it.

CITATIONS:
- After each factual claim, cite its source inline using [[chunk:CHUNK_ID]] for retrieved text or [[control:CONTROL_ID]] for live control data. The UI turns these into clickable links, so use the exact IDs given in the context.

Be concise, professional, and audit-appropriate.`;

// ---------------------------------------------------------------------------
// Chunk thresholding
// ---------------------------------------------------------------------------

/** Chunks that pass the similarity threshold, most-similar first. */
export function passingChunks(chunks: ScoredChunk[]): ScoredChunk[] {
  return chunks
    .filter((c) => c.distance <= SIMILARITY_DISTANCE_THRESHOLD)
    .sort((a, b) => a.distance - b.distance);
}

/** True when retrieval produced no usable signal → force the fixed fallback. */
export function hasInsufficientContext(context: RetrievedContext): boolean {
  return passingChunks(context.chunks).length === 0 && context.liveControls.length === 0;
}

// ---------------------------------------------------------------------------
// Context block + user prompt composition
// ---------------------------------------------------------------------------

function renderContextBlock(context: RetrievedContext): string {
  const chunks = passingChunks(context.chunks);
  const chunkLines = chunks.length
    ? chunks
        .map((c) => `<chunk id="${c.id}" source="${c.sourceDocumentId ?? c.documentId}" distance="${c.distance.toFixed(3)}">\n${c.content}\n</chunk>`)
        .join("\n")
    : "(none)";

  const relLines = context.graphRelations.length
    ? context.graphRelations.map((r) => `- ${r.fromLabel} —[${r.relation}]→ ${r.toLabel}`).join("\n")
    : "(none)";

  const controlLines = context.liveControls.length
    ? context.liveControls
        .map(
          (c) =>
            `<control id="${c.controlId}" code="${c.code ?? ""}" framework="${c.frameworkName}" status="${c.status}">${c.title}${
              c.mappedTo.length ? ` (maps to: ${c.mappedTo.join(", ")})` : ""
            }</control>`,
        )
        .join("\n")
    : "(none)";

  return [
    "<retrieved_chunks>",
    chunkLines,
    "</retrieved_chunks>",
    "<graph_relations>",
    relLines,
    "</graph_relations>",
    "<live_controls>",
    controlLines,
    "</live_controls>",
  ].join("\n");
}

/** Generic Q&A user prompt: context block + the user's question. */
export function composeUserPrompt(query: string, context: RetrievedContext): string {
  return `${renderContextBlock(context)}\n\nUser question: ${query}\n\nAnswer using only the context above, with inline [[chunk:ID]] / [[control:ID]] citations.`;
}

/** Gap-assessment prompt (1_PRD.md / 3_APP_FLOW.md §5 "gap analysis against SOC2 CC6"). */
export function buildGapAssessmentPrompt(frameworkName: string, context: RetrievedContext): string {
  return `${renderContextBlock(context)}

Task: Produce a GAP ASSESSMENT for "${frameworkName}" using only the context above.
Return a structured breakdown:
1. PASSING — controls/requirements with satisfying evidence (cite [[control:ID]] and the evidence [[chunk:ID]]).
2. FAILING / GAPS — controls with missing, stale, or insufficient evidence (cite [[control:ID]]).
3. RECOMMENDED NEXT STEPS — concrete actions to close each gap.
If the context lacks the data to assess a control, list it under "Unknown — insufficient evidence" rather than guessing.`;
}

/** Policy-draft prompt (1_PRD.md "Draft a policy for access control"). */
export function buildPolicyDraftPrompt(topic: string, context: RetrievedContext): string {
  return `${renderContextBlock(context)}

Task: Draft a compliance policy for "${topic}", grounded in the organization's context above.
Structure: Purpose, Scope, Policy Statements, Roles & Responsibilities, Enforcement, Review Cadence.
Where the context references specific controls, align statements to them and cite [[control:ID]]. Do not invent regulatory citations that are not present in the context.`;
}

// ---------------------------------------------------------------------------
// Intent detection (cheap keyword matching — NOT an LLM call)
// ---------------------------------------------------------------------------

export type AdvisorIntent = "gap_assessment" | "policy_draft" | "qa";

export function detectIntent(message: string): AdvisorIntent {
  const m = message.toLowerCase();
  if (/\bgap (analysis|assessment)\b|\bassess(ment)?\b.*\bgap|\bgaps?\b.*\b(against|for|in)\b/.test(m)) {
    return "gap_assessment";
  }
  if (/\b(draft|write|generate|create)\b.*\bpolicy\b|\bpolicy\b.*\bfor\b/.test(m)) {
    return "policy_draft";
  }
  return "qa";
}

// ---------------------------------------------------------------------------
// Output-scope validation (cheap post-generation check — NOT an LLM call)
// ---------------------------------------------------------------------------

export interface ScopeValidation {
  flagged: boolean;
  reasons: string[];
}

// Fenced code blocks tagged with a general-purpose programming language are a
// strong signal the model drifted out of the compliance domain.
const CODE_FENCE_RE = /```(?:python|javascript|typescript|js|ts|java|c\+\+|cpp|c#|csharp|go|rust|ruby|php|bash|sh|sql|html|css)\b/i;

/**
 * Flags (does not rewrite) responses that look out-of-domain. Returns
 * `flagged: true` with reasons so the router can audit-log the event and the
 * UI/ops team can review — the model's text is never silently altered.
 */
export function validateOutputScope(responseText: string): ScopeValidation {
  const reasons: string[] = [];
  const text = responseText ?? "";

  if (CODE_FENCE_RE.test(text)) {
    reasons.push("Response contains a code block in a general-purpose programming language.");
  }
  // Contradiction: claims insufficient info yet also produces a long substantive answer.
  if (text.includes(INSUFFICIENT_CONTEXT_ANSWER) && text.replace(INSUFFICIENT_CONTEXT_ANSWER, "").trim().length > 200) {
    reasons.push("Response asserts insufficient information but also produces a substantive answer.");
  }

  return { flagged: reasons.length > 0, reasons };
}
