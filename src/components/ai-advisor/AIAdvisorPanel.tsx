"use client";

/**
 * src/components/ai-advisor/AIAdvisorPanel.tsx
 *
 * Phase 7 Part 3 — the AI Advisor slide-over (4_UI_UX_DESIGN.md "Chat panel:
 * Slide-over from right, resizable."). Composes ContextBar, message list with
 * MessageBubble + TypingIndicator, DocumentUploadPanel, and MessageInput.
 *
 * Streaming: Part 2 exposes `sendMessage` as a buffered mutation (no SSE/
 * subscription transport exists in the repo). We show a TypingIndicator while
 * the mutation is in flight and render the full assistant message on resolve.
 * The `aria-live="polite"` region announces new assistant content to screen
 * readers. The token-streaming seam is ready for a future SSE transport.
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { MessageBubble, type AdvisorCitationRef } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { MessageInput } from "./MessageInput";
import { ContextBar } from "./ContextBar";
import { DocumentUploadPanel } from "./DocumentUploadPanel";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  citations?: AdvisorCitationRef[];
  /**
   * GH #25 — this turn did not happen. Retrieval failed, so NO assessment was
   * performed against the knowledge base.
   *
   * Modelled as a transcript entry rather than only a toast, deliberately. A
   * toast disappears; what persists is the user's question sitting in the
   * transcript with no reply under it, which reads as "the advisor had nothing
   * to say" — i.e. as an all-clear. For a user preparing an audit, that is the
   * single most dangerous thing this panel could imply, so the absence of an
   * answer has to be stated where the answer would have been.
   */
  failed?: boolean;
}

const MIN_WIDTH = 360;
const MAX_WIDTH = 720;

export function AIAdvisorPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [width, setWidth] = useState(440);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [contextSummary, setContextSummary] = useState<string[]>([]);
  const draggingRef = useRef(false);

  const usageQuery = api.aiAdvisor.getUsageSummary.useQuery(undefined, { enabled: open });
  // Probed on mount so an unavailable model degrades the panel up front rather
  // than letting the user compose a message into a guaranteed failure.
  const healthQuery = api.aiAdvisor.checkHealth.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const sendMessage = api.aiAdvisor.sendMessage.useMutation();

  // Treat only a resolved unhealthy answer as degraded — while the probe is in
  // flight we must not flash a false "unavailable" banner.
  const degraded = healthQuery.isSuccess && !healthQuery.data.healthy;
  const degradedMessage =
    healthQuery.data?.message ?? "The AI assistant is temporarily unavailable — try again shortly.";

  const onSend = useCallback(
    async (message: string) => {
      setMessages((prev) => [...prev, { role: "user", content: message }]);
      try {
        const res = await sendMessage.mutateAsync({ sessionId, message });
        setSessionId(res.sessionId);
        setContextSummary(res.contextSummary ?? []);
        setMessages((prev) => [...prev, { role: "assistant", content: res.message, citations: res.citations }]);
        void usageQuery.refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        const budget = msg.includes("AI_BUDGET_EXCEEDED");
        toast.error(budget ? "Monthly AI token budget reached." : msg);

        // GH #25 — and leave a permanent mark in the transcript. The toast is
        // the notification; this is the record, and it is the half that stops
        // an unanswered question from reading as a clean result.
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            failed: true,
            content: budget
              ? "Your organization's monthly AI budget is exhausted, so this question was not assessed. No analysis of your compliance data was performed."
              : "The Compliance Advisor is unavailable, so this question was NOT assessed. Nothing was checked against your compliance data — this is not a finding of \u201Cno gaps\u201D. Try again once the assistant is available.",
          },
        ]);
        void usageQuery.refetch();
      }
    },
    [sendMessage, sessionId, usageQuery],
  );

  // Drag-to-resize on the left edge.
  const onDragStart = () => {
    draggingRef.current = true;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Compliance Advisor"
        /*
          max-w-[100vw] is load-bearing, not belt-and-braces. This panel is
          position:fixed, so it sits OUTSIDE the dashboard shell's
          overflow-x-hidden and nothing else can contain it. At its 440px
          default — and at the 360px MIN_WIDTH the resize handle enforces — it is
          wider than a 390px phone viewport and would push the page sideways.
          Capping to the viewport makes it full-bleed on mobile, which is the
          right behaviour for a slide-over anyway.
        */
        className="fixed right-0 top-0 z-50 flex h-full max-w-[100vw] flex-col border-l border-dharma-border bg-dharma-surface"
        style={{ width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          tabIndex={0}
          onMouseDown={onDragStart}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setWidth((w) => Math.min(MAX_WIDTH, w + 20));
            if (e.key === "ArrowRight") setWidth((w) => Math.max(MIN_WIDTH, w - 20));
          }}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-dharma-accent-hover focus-visible:bg-dharma-accent-tint focus-visible:outline-none"
        />

        <header className="flex items-center justify-between border-b border-dharma-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Compliance Advisor</h2>
            <p className="text-xs text-dharma-ink-secondary">Grounded in your compliance data</p>
          </div>
          <button onClick={onClose} aria-label="Close advisor" className="rounded-md p-1 text-dharma-ink-secondary hover:bg-dharma-accent hover:text-dharma-ink-inverse">
            ✕
          </button>
        </header>

        {degraded && (
          <div
            role="status"
            className="border-b border-dharma-warning bg-dharma-warning-bg px-4 py-2 text-xs text-dharma-ink"
          >
            {degradedMessage}
          </div>
        )}

        <ContextBar sources={contextSummary} />
        <DocumentUploadPanel />

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 && (
            <p className="mt-8 text-center text-sm text-dharma-ink-secondary">
              Ask about your controls, evidence, or request a gap analysis.
            </p>
          )}
          <div aria-live="polite" className="space-y-3">
            {messages.map((m, i) =>
              m.failed ? (
                // GH #25 — deliberately NOT a MessageBubble. A failed turn must
                // not be able to pass for an answer, so it does not share the
                // assistant bubble's shape or colour; it uses the danger
                // treatment and role="alert" so screen readers announce it as a
                // failure rather than reading it out as the reply.
                <div
                  key={i}
                  role="alert"
                  data-testid="advisor-turn-failed"
                  className="flex items-start gap-2 rounded-lg border border-dharma-danger bg-dharma-danger-bg p-3 text-xs text-dharma-danger-text"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{m.content}</span>
                </div>
              ) : (
                <MessageBubble key={i} role={m.role} content={m.content} citations={m.citations} />
              ),
            )}
          </div>
          {sendMessage.isPending && <TypingIndicator />}
        </div>

        <MessageInput
          onSend={(m) => void onSend(m)}
          disabled={sendMessage.isPending || degraded}
          usage={usageQuery.data}
        />
      </aside>
    </>
  );
}
