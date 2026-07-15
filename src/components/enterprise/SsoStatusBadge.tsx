"use client";

// Phase 8 Part 1 — SSO status indicator. Reuses the pulsating-dot
// micro-interaction pattern from ConnectorsList.tsx (UI_UX doc specifies the
// same treatment for connector status) rather than inventing a new one.
import React from "react";

export type SsoStatus = "NOT_CONFIGURED" | "CONFIGURED" | "ENFORCED";

const STATUS_STYLES: Record<SsoStatus, { dot: string; label: string; pulse?: boolean }> = {
  NOT_CONFIGURED: { dot: "bg-stone-400", label: "Not configured" },
  CONFIGURED: { dot: "bg-emerald-500", label: "Configured", pulse: true },
  ENFORCED: { dot: "bg-blue-500", label: "SSO-only enforced", pulse: true },
};

export function SsoStatusBadge({ status }: { status: SsoStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
      <span className="relative flex h-2.5 w-2.5">
        {style.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
      </span>
      {style.label}
    </span>
  );
}
