"use client";

/**
 * src/components/evidence/EvidenceAutoTagSuggestions.tsx
 *
 * Phase 7 Part 3 — surfaces NLP evidence auto-tag SUGGESTIONS with explicit
 * accept/reject controls (PRD Phase 7). A suggestion is never applied silently:
 * the association is persisted only when the user clicks Accept, preserving
 * audit integrity. Badge format per the master prompt: "AI-suggested: Control
 * CC6.1 (82% match)".
 */

import { toast } from "sonner";
import { api } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface AutoTagSuggestion {
  controlId: string;
  code: string | null;
  title: string;
  confidence: number; // 0..1
}

export interface EvidenceAutoTagSuggestionsProps {
  evidenceId: string;
  suggestions: AutoTagSuggestion[];
  onChange?: () => void;
}

export function EvidenceAutoTagSuggestions({ evidenceId, suggestions, onChange }: EvidenceAutoTagSuggestionsProps) {
  const accept = api.evidence.acceptAutoTag.useMutation({
    onSuccess: () => {
      toast.success("Suggested control association added.");
      onChange?.();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = api.evidence.rejectAutoTag.useMutation({
    onSuccess: () => {
      toast.success("Suggestions dismissed.");
      onChange?.();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!suggestions || suggestions.length === 0) return null;
  const busy = accept.isPending || reject.isPending;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3" aria-label="AI-suggested control tags">
      <p className="mb-2 text-xs font-medium text-muted-foreground">AI-suggested controls for this evidence</p>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li key={s.controlId} className="flex items-center justify-between gap-2">
            <Badge variant="secondary" className="truncate" title={s.title}>
              {`AI-suggested: ${s.code ?? s.title} (${Math.round(s.confidence * 100)}% match)`}
            </Badge>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="default"
                disabled={busy}
                aria-label={`Accept suggested control ${s.code ?? s.title}`}
                onClick={() => accept.mutate({ evidenceId, controlId: s.controlId })}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`Reject suggested control ${s.code ?? s.title}`}
                onClick={() => reject.mutate({ evidenceId })}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
