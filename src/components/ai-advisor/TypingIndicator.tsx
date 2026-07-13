"use client";

/**
 * src/components/ai-advisor/TypingIndicator.tsx
 *
 * Phase 7 Part 3 — animated dots shown while awaiting the assistant's response
 * (4_UI_UX_DESIGN.md "Typing indicator, streaming text").
 */

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-2" role="status" aria-label="Assistant is typing">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary" aria-hidden="true">
        AI
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
