"use client";

/**
 * src/components/ai-advisor/AIAdvisorTrigger.tsx
 *
 * Phase 7 Part 3 — floating action button that opens the AI Advisor slide-over
 * (4_UI_UX_DESIGN.md / 3_APP_FLOW.md §5: "open chat (floating button or
 * sidebar)"). Mounted once in the dashboard layout.
 */

import { useState } from "react";
import dynamic from "next/dynamic";

/**
 * WAVE 11.2 (fullstack-audit-2026-08-06 §8 MEDIUM-1) — code-split the panel.
 *
 * This trigger is mounted in the dashboard layout, so it renders on EVERY
 * dashboard route. A static import pulled the whole Advisor tree
 * (AIAdvisorPanel -> MessageBubble, MessageInput, DocumentUploadPanel,
 * CitationChip, ContextBar, TypingIndicator) into the shared bundle for every
 * user, including those who never open it. `grep -rn "next/dynamic" src`
 * returned zero hits app-wide, so there was no code-splitting anywhere — the
 * same shape as the Stripe-global-load issue WAVE 3.2 fixed, different payload.
 *
 * ssr: false because the panel is chat UI behind a click: it has no meaningful
 * server-rendered form, and rendering it on the server would put it back in
 * the initial payload, defeating the split.
 *
 * No `loading` skeleton: the chunk is requested on the click that opens the
 * panel, and the panel animates in. A skeleton for a chunk that arrives in
 * ~100ms is more flicker than feedback.
 */
const AIAdvisorPanel = dynamic(
  () => import("./AIAdvisorPanel").then((m) => m.AIAdvisorPanel),
  { ssr: false },
);

export function AIAdvisorTrigger() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        aria-label="Open Compliance Advisor"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-dharma-accent text-dharma-ink-inverse border border-dharma-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent focus-visible:ring-offset-2"
      >
        <span aria-hidden="true" className="text-xl">💬</span>
      </button>
      {/* Mounted only after the first open: `dynamic` splits the chunk, but
          rendering the component still requests it, so gating on `mounted`
          keeps the request itself off the critical path for users who never
          open the Advisor. Kept mounted afterwards so conversation state
          survives closing and reopening. */}
      {mounted && <AIAdvisorPanel open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
