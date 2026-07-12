"use client";

import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number; // 0-100
  size?: number;
  strokeWidth?: number;
  /** Compact mode drops the label text — used for the frameworks-list badge. */
  compact?: boolean;
  className?: string;
}

// Same red -> amber -> green severity language as SeverityBadge / PenTestCard,
// applied to score bands: red <50, amber 50-75, green 75+.
function bandFor(score: number): { stroke: string; text: string; label: string } {
  if (score < 50) return { stroke: "stroke-red-500", text: "text-red-600 dark:text-red-400", label: "Needs Attention" };
  if (score < 75) return { stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400", label: "In Progress" };
  return { stroke: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "On Track" };
}

export function ScoreGauge({ score, size = 140, strokeWidth = 12, compact = false, className }: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = bandFor(clamped);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Readiness score: ${Math.round(clamped)} out of 100`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-muted"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn("transition-[stroke-dashoffset] duration-500 ease-out", band.stroke)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold tabular-nums", compact ? "text-lg" : "text-3xl", band.text)}>
            {Math.round(clamped)}
          </span>
          {!compact && <span className="text-[10px] text-muted-foreground">/ 100</span>}
        </div>
      </div>
      {!compact && (
        <span className={cn("mt-1.5 text-xs font-medium", band.text)}>{band.label}</span>
      )}
    </div>
  );
}
