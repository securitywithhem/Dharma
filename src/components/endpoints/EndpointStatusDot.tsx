"use client";

// Phase 9 Part 1 — endpoint status indicator. Reuses the exact pulsating-dot
// micro-interaction pattern from ConnectorsList (4_UI_UX_DESIGN.md specifies
// the same treatment for connector status), pulsing on the live ACTIVE state.
import React from "react";

const STATUS_STYLES: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  PENDING: { dot: "bg-dharma-warning-bg", label: "Pending enrollment", pulse: true },
  ACTIVE: { dot: "bg-dharma-success-bg", label: "Active", pulse: true },
  STALE: { dot: "bg-dharma-surface-hover-foreground", label: "Stale" },
  REVOKED: { dot: "bg-dharma-danger-bg", label: "Revoked" },
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
      <span className="text-xs text-dharma-ink-secondary">{style.label}</span>
    </span>
  );
}
