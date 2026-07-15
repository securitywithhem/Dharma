"use client";

// Phase 9 Part 1 — endpoint status indicator. Reuses the exact pulsating-dot
// micro-interaction pattern from ConnectorsList (4_UI_UX_DESIGN.md specifies
// the same treatment for connector status), pulsing on the live ACTIVE state.
import React from "react";

const STATUS_STYLES: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  PENDING: { dot: "bg-amber-500", label: "Pending enrollment", pulse: true },
  ACTIVE: { dot: "bg-emerald-500", label: "Active", pulse: true },
  STALE: { dot: "bg-stone-400", label: "Stale" },
  REVOKED: { dot: "bg-red-500", label: "Revoked" },
};

export function EndpointStatusDot({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.STALE;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {style.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
      </span>
      <span className="text-xs text-muted-foreground">{style.label}</span>
    </span>
  );
}
