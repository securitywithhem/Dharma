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
  if (pct >= 80) return "[&>div]:bg-emerald-500";
  if (pct >= 40) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-rose-500";
}

function getTextColour(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-500 dark:text-rose-400";
}

export function DomainBreakdown({ breakdown }: DomainBreakdownProps) {
  if (breakdown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No domains found.</p>
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
              <span className="text-xs text-muted-foreground tabular-nums">
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
