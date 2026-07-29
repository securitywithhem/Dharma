"use client";

import { cn } from "@/lib/utils";
import { DharmaRing } from "@/components/DharmaRing";
import type { Severity } from "@/components/ui/status-badge";

interface ScoreGaugeProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
  /** Compact mode drops the label text — used for the frameworks-list badge. */
  compact?: boolean;
  /** Play the ring's settle animation (a freshly computed score). */
  animated?: boolean;
  className?: string;
}

/**
 * Score bands expressed in the severity vocabulary rather than their own
 * red/amber/green ramp. A gap in readiness IS a finding, so it should be
 * coloured like one — the previous hardcoded emerald/amber/red drifted from
 * the badge ramp and shifted independently in dark mode.
 */
function bandFor(score: number): { severity: Severity; label: string } {
  if (score < 50) return { severity: "CRITICAL", label: "Needs Attention" };
  if (score < 75) return { severity: "MEDIUM", label: "In Progress" };
  return { severity: "LOW", label: "On Track" };
}

const TEXT_CLASS: Record<Severity, string> = {
  NONE: "text-dharma-ink-muted",
  LOW: "text-dharma-info",
  MEDIUM: "text-dharma-warning",
  HIGH: "text-dharma-danger",
  CRITICAL: "text-dharma-danger",
};

export function ScoreGauge({
  score,
  size = 140,
  strokeWidth = 12,
  compact = false,
  animated = false,
  className,
}: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = bandFor(clamped);
  const rounded = Math.round(clamped);

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <DharmaRing
        segments={[{ severity: band.severity, value: clamped }]}
        total={100}
        size={size}
        strokeWidth={strokeWidth}
        animated={animated}
        label={`Readiness score: ${rounded} out of 100 — ${band.label}`}
      >
        <span
          data-numeric=""
          className={cn(
            "font-semibold tabular-nums",
            compact ? "text-lg" : "text-display-sm",
            TEXT_CLASS[band.severity],
          )}
        >
          {rounded}
        </span>
        {!compact && <span className="text-micro text-dharma-ink-secondary">/ 100</span>}
      </DharmaRing>
      {!compact && (
        <span className={cn("mt-1.5 text-meta font-medium", TEXT_CLASS[band.severity])}>
          {band.label}
        </span>
      )}
    </div>
  );
}
