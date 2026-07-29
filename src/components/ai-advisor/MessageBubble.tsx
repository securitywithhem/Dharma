"use client";

/**
 * src/components/ai-advisor/MessageBubble.tsx
 *
 * Phase 7 Part 3 — chat message bubble (4_UI_UX_DESIGN.md: "User messages
 * right-aligned, AI left-aligned with avatar. Citations as clickable chips.").
 * Inline [[chunk:ID]]/[[control:ID]] markers are rendered as CitationChips;
 * everything else is plain text. Malformed markers degrade to text.
 */

import { cn } from "@/lib/utils";
import { parseMessageSegments } from "@/lib/ai/parseCitations";
import { CitationChip } from "./CitationChip";

export interface AdvisorCitationRef {
  type: "chunk" | "control" | "evidence";
  id: string;
}

export interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  /** Backend-provided citations for this message → allow-list for links. */
  citations?: AdvisorCitationRef[];
  /** True while the assistant message is still streaming (for aria-busy). */
  streaming?: boolean;
}

export function MessageBubble({ role, content, citations, streaming }: MessageBubbleProps) {
  const isUser = role === "user";
  const allowedIds = new Set((citations ?? []).map((c) => c.id));
  const segments = parseMessageSegments(content);

  return (
    <div className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div
          aria-hidden="true"
          className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dharma-accent-tint text-xs font-semibold text-dharma-accent-on-tint"
        >
          AI
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isUser ? "bg-dharma-accent text-dharma-ink-inverse rounded-br-sm" : "bg-dharma-surface-hover text-dharma-ink rounded-bl-sm",
        )}
        aria-busy={streaming ? "true" : undefined}
      >
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <span key={i} className="whitespace-pre-wrap">
              {seg.text}
            </span>
          ) : (
            <CitationChip key={i} type={seg.type} id={seg.id} allowedIds={allowedIds} />
          ),
        )}
      </div>
    </div>
  );
}
