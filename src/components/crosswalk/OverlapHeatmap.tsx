"use client";

import { Fragment, useState } from "react";
import { Grid3x3 } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface OverlapHeatmapProps {
  frameworkAId: string;
  frameworkBId: string;
  onDrillDown: (familyAId: string, familyBId: string) => void;
}

// Validated single-hue sequential ramp (blue), 5 steps, low→high coverage.
// Light: node scripts/validate_palette.js "#86b6ef,#5598e7,#2a78d6,#1c5cab,#0d366b" --mode light --ordinal → ALL CHECKS PASS
// Dark:  node scripts/validate_palette.js "#184f95,#256abf,#3987e5,#6da7ec,#b7d3f6" --mode dark --ordinal → ALL CHECKS PASS
// 0% coverage is rendered as the neutral surface, not the ramp's lightest step —
// sequential "near zero recedes toward surface", so it isn't a ramp step at all.
const BUCKET_CLASSES = [
  "bg-[#86b6ef] dark:bg-[#184f95]",
  "bg-[#5598e7] dark:bg-[#256abf]",
  "bg-[#2a78d6] dark:bg-[#3987e5]",
  "bg-[#1c5cab] dark:bg-[#6da7ec]",
  "bg-[#0d366b] dark:bg-[#b7d3f6]",
];

function bucketClass(coveragePct: number): string {
  if (coveragePct <= 0) return "bg-muted/40";
  const index = Math.min(4, Math.floor(coveragePct / 20));
  return BUCKET_CLASSES[index];
}

/** Text stays legible against every ramp step — dark ink at low steps, light ink at high steps. */
function textClass(coveragePct: number): string {
  if (coveragePct <= 0) return "text-muted-foreground";
  const index = Math.min(4, Math.floor(coveragePct / 20));
  return index >= 3 ? "text-white dark:text-[#0d1420]" : "text-[#0d1420] dark:text-white";
}

export function OverlapHeatmap({ frameworkAId, frameworkBId, onDrillDown }: OverlapHeatmapProps) {
  const { data, isLoading, isError, error } = api.controlMapping.getOverlapMatrix.useQuery({
    frameworkAId,
    frameworkBId,
  });
  const [hovered, setHovered] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed border-destructive/40 py-10 text-center text-sm text-destructive">
        {error?.message ?? "Failed to load the overlap matrix."}
      </div>
    );
  }

  if (!data || data.familiesA.length === 0 || data.familiesB.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center">
        <Grid3x3 className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">No overlap data yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add controls to both frameworks to see a coverage matrix.
        </p>
      </div>
    );
  }

  const cellFor = (familyAId: string, familyBId: string) =>
    data.cells.find((c) => c.familyAId === familyAId && c.familyBId === familyBId);

  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label={`Overlap coverage between ${data.frameworkA.name} and ${data.frameworkB.name}`}
        className="inline-grid gap-1"
        style={{
          gridTemplateColumns: `160px repeat(${data.familiesA.length}, minmax(96px, 1fr))`,
        }}
      >
        {/* Corner */}
        <div className="sticky left-0 z-10 flex items-end pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {data.frameworkB.name} ↓ / {data.frameworkA.name} →
        </div>
        {/* Column headers: families of framework A */}
        {data.familiesA.map((famA) => (
          <div
            key={famA.familyId}
            role="columnheader"
            className="truncate px-1 pb-1 text-center text-[11px] font-medium text-muted-foreground"
            title={famA.familyName}
          >
            {famA.familyName}
          </div>
        ))}

        {/* Rows: families of framework B */}
        {data.familiesB.map((famB) => (
          <Fragment key={famB.familyId}>
            <div
              role="rowheader"
              className="sticky left-0 z-10 truncate bg-background pr-2 py-1.5 text-[11px] font-medium text-muted-foreground"
              title={famB.familyName}
            >
              {famB.familyName}
            </div>
            {data.familiesA.map((famA) => {
              const cell = cellFor(famA.familyId, famB.familyId);
              const pct = cell?.coveragePct ?? 0;
              const key = `${famA.familyId}::${famB.familyId}`;
              return (
                <button
                  key={key}
                  role="gridcell"
                  onClick={() => onDrillDown(famA.familyId, famB.familyId)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                  aria-label={`${famA.familyName} × ${famB.familyName}: ${pct}% coverage, ${cell?.mappingCount ?? 0} mapping(s)`}
                  className={cn(
                    "relative flex h-10 items-center justify-center rounded-sm text-xs font-semibold transition-transform",
                    bucketClass(pct),
                    textClass(pct),
                    hovered === key && "z-20 scale-[1.06] ring-2 ring-primary",
                  )}
                >
                  {pct > 0 ? `${Math.round(pct)}%` : "–"}
                  {hovered === key && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-normal text-popover-foreground shadow-md">
                      {cell?.mappingCount ?? 0} mapping{(cell?.mappingCount ?? 0) === 1 ? "" : "s"} · click to view
                    </div>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Coverage:</span>
        <div className="flex items-center gap-0.5">
          <span className="h-3 w-3 rounded-sm bg-muted/40" />
          {BUCKET_CLASSES.map((c, i) => (
            <span key={i} className={cn("h-3 w-3 rounded-sm", c)} />
          ))}
        </div>
        <span>0% → 100%</span>
      </div>
    </div>
  );
}
