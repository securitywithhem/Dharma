"use client";

/**
 * src/components/ai-advisor/MessageInput.tsx
 *
 * Phase 7 Part 3 — textarea + send button for the chat panel. Disabled while a
 * response is in flight; shows a remaining-token indicator when the org nears
 * its monthly AI budget. Enter sends, Shift+Enter newlines.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface UsageSummary {
  used: number;
  limit: number;
  remaining: number;
}

export interface MessageInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  usage?: UsageSummary;
}

/** Warn when under 15% of the monthly budget remains. */
const LOW_BUDGET_RATIO = 0.15;

export function MessageInput({ onSend, disabled, usage }: MessageInputProps) {
  const [value, setValue] = useState("");

  const budgetExceeded = !!usage && usage.remaining <= 0;
  const lowBudget = !!usage && usage.limit > 0 && usage.remaining / usage.limit <= LOW_BUDGET_RATIO;
  const canSend = value.trim().length > 0 && !disabled && !budgetExceeded;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="border-t border-border p-3">
      {usage && (lowBudget || budgetExceeded) && (
        <div
          className={cn("mb-2 rounded-md px-2 py-1 text-xs", budgetExceeded ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}
          role="status"
          aria-live="polite"
        >
          {budgetExceeded
            ? "Monthly AI token budget reached. Chat is paused until it resets or your plan is upgraded."
            : `Low AI budget: ${usage.remaining.toLocaleString()} of ${usage.limit.toLocaleString()} tokens left this month.`}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={budgetExceeded ? "Monthly budget reached" : "Ask about your controls, evidence, or a gap analysis…"}
          aria-label="Message the compliance advisor"
          rows={2}
          disabled={disabled || budgetExceeded}
          className="min-h-[44px] resize-none"
        />
        <Button onClick={submit} disabled={!canSend} aria-label="Send message">
          Send
        </Button>
      </div>
    </div>
  );
}
