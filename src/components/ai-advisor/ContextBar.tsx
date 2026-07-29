"use client";

/**
 * src/components/ai-advisor/ContextBar.tsx
 *
 * Phase 7 Part 3 — shows what documents/frameworks are currently loaded into
 * the advisor's context (4_UI_UX_DESIGN.md "Context bar: Shows what
 * documents/frameworks are loaded."). Fed by the additive `contextSummary`
 * returned from aiAdvisor.sendMessage.
 */

import { Badge } from "@/components/ui/badge";

export interface ContextBarProps {
  sources: string[];
}

export function ContextBar({ sources }: ContextBarProps) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-dharma-border bg-dharma-surface-hover px-3 py-2" aria-label="Context sources">
      <span className="text-xs font-medium text-dharma-ink-secondary">Context:</span>
      {sources.map((s, i) => (
        <Badge key={`${s}-${i}`} variant="secondary" className="max-w-[180px] truncate" title={s}>
          {s}
        </Badge>
      ))}
    </div>
  );
}
