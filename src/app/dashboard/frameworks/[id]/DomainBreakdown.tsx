"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface DomainBreakdownItem {
  domain: string;
  total: number;
  compliant: number;
  percentage: number;
}

interface DomainBreakdownProps {
  breakdown: DomainBreakdownItem[];
}

function getBarColour(pct: number): string {
  if (pct >= 80) return "[&>div]:bg-dharma-success-bg";
  if (pct >= 40) return "[&>div]:bg-dharma-warning-bg";
  return "[&>div]:bg-dharma-danger-bg";
}

function getTextColour(pct: number): string {
  if (pct >= 80) return "text-dharma-success-text";
  if (pct >= 40) return "text-dharma-ink";
  return "text-dharma-danger-text";
}

export function DomainBreakdown({ breakdown }: DomainBreakdownProps) {
  if (breakdown.length === 0) {
    return (
      <p className="text-sm text-dharma-ink-secondary">No domains found.</p>
    );
  }

  return (
    <div
      className="grid gap-5 sm:grid-cols-2"
      role="region"
      aria-label="Compliance by domain"
    >
      {breakdown.map((item) => (
        <div key={item.domain} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4
              className="text-sm font-medium leading-tight truncate"
              title={item.domain}
            >
              {item.domain}
            </h4>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-dharma-ink-secondary tabular-nums">
                {item.compliant}/{item.total}
              </span>
              <span
                className={cn(
                  "text-sm font-bold tabular-nums",
                  getTextColour(item.percentage),
                )}
              >
                {Math.round(item.percentage)}%
              </span>
            </div>
          </div>
          <Progress
            value={item.percentage}
            className={cn("h-2", getBarColour(item.percentage))}
            aria-label={`${item.domain}: ${Math.round(item.percentage)}% compliant`}
          />
        </div>
      ))}
    </div>
  );
}
