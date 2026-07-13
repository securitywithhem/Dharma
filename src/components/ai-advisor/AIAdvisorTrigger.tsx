"use client";

/**
 * src/components/ai-advisor/AIAdvisorTrigger.tsx
 *
 * Phase 7 Part 3 — floating action button that opens the AI Advisor slide-over
 * (4_UI_UX_DESIGN.md / 3_APP_FLOW.md §5: "open chat (floating button or
 * sidebar)"). Mounted once in the dashboard layout.
 */

import { useState } from "react";
import { AIAdvisorPanel } from "./AIAdvisorPanel";

export function AIAdvisorTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Compliance Advisor"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span aria-hidden="true" className="text-xl">💬</span>
      </button>
      <AIAdvisorPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
