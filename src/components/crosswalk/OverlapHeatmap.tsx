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

// Single-hue sequential ramp, 5 steps, low→high coverage. This used to be a
// second, separately-validated blue ramp hardcoded as hex + dark: pairs. It
// duplicated --seq-1..5 in globals.css, which is the same thing: one hue,
// light→dark, for encoding magnitude. Consolidated onto the token, which also
// measures better — the old step 3 (#2a78d6) reached only 4.18:1 against ink,
// where --seq-3 reaches 5.20:1.
//
// 0% coverage is rendered as the neutral surface, not the ramp's lightest step —
// sequential "near zero recedes toward surface", so it isn't a ramp step at all.
const BUCKET_CLASSES = [
  "bg-seq-1",
  "bg-seq-2",
  "bg-seq-3",
  "bg-seq-4",
  "bg-seq-5",
];

function bucketClass(coveragePct: number): string {
  if (coveragePct <= 0) return "bg-dharma-surface-hover";
  const index = Math.min(4, Math.floor(coveragePct / 20));
  return BUCKET_CLASSES[index];
}

/**
 * Cell label stays legible against every ramp step. --foreground/--background
 * already invert per mode, so no `dark:` override is needed for *which colour*
 * — only for *where the ramp flips*, because the ramp is light→dark in light
 * mode and dark→light in dark mode, so the flip lands on a different step.
 *
 * Measured against the tokens (AA 4.5:1 for this small numeric text):
 *   light  seq-1..3 on ink 13.40 / 8.99 / 5.20 · seq-4..5 on paper 5.42 / 8.90
 *   dark   seq-1..3 on fg  11.20 / 8.55 / 6.36 · seq-4 on fg 4.78 · seq-5 on bg 6.34
 */
function textClass(coveragePct: number): string {
  if (coveragePct <= 0) return "text-dharma-ink-secondary";
  const index = Math.min(4, Math.floor(coveragePct / 20));
  if (index >= 4) return "text-dharma-ink-inverse";
  if (index === 3) return "text-dharma-ink-inverse dark:text-dharma-ink";
  return "text-dharma-ink";
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
      <div className="rounded-lg border border-dashed border-dharma-danger py-10 text-center text-sm text-dharma-danger-text">
        {error?.message ?? "Failed to load the overlap matrix."}
      </div>
    );
  }

  if (!data || data.familiesA.length === 0 || data.familiesB.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-dharma-border py-12 text-center">
        <Grid3x3 className="mx-auto h-8 w-8 text-dharma-ink-secondary" />
        <p className="mt-3 text-sm font-medium">No overlap data yet</p>
        <p className="mt-1 text-xs text-dharma-ink-secondary">
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
          gridTemplateColumns: `160px repeat(${data.familiesA.length}, minmax(120px, 1fr))`,
        }}
      >
        {/* Corner */}
        <div className="sticky left-0 z-10 flex items-end pb-1 text-[10px] font-medium uppercase tracking-wide text-dharma-ink-secondary">
          {data.frameworkB.name} ↓ / {data.frameworkA.name} →
        </div>
        {/* Column headers: families of framework A */}
        {data.familiesA.map((famA) => (
          <div
            key={famA.familyId}
            role="columnheader"
            className="line-clamp-2 min-h-[2.4rem] break-words px-1 pb-1 text-center text-[11px] font-medium leading-tight text-dharma-ink-secondary"
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
              className="sticky left-0 z-10 truncate bg-dharma-bg pr-2 py-1.5 text-[11px] font-medium text-dharma-ink-secondary"
              title={famB.familyName}
            >
              {famB.familyName}
            </div>
            {data.familiesA.map((famA) => {
              const cell = cellFor(famA.familyId, famB.familyId);
              const pct = cell?.coveragePct ?? 0;
              const proposed = cell?.proposedCount ?? 0;
              const key = `${famA.familyId}::${famB.familyId}`;
              return (
                <button
                  key={key}
                  role="gridcell"
                  onClick={() => onDrillDown(famA.familyId, famB.familyId)}
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
                  aria-label={`${famA.familyName} × ${famB.familyName}: ${pct}% coverage, ${cell?.mappingCount ?? 0} mapping(s)${proposed > 0 ? `, ${proposed} proposed pending review` : ""}`}
                  className={cn(
                    "relative flex h-10 items-center justify-center rounded-sm text-xs font-semibold transition-transform",
                    bucketClass(pct),
                    textClass(pct),
                    hovered === key && "z-20 scale-[1.06] ring-2 ring-dharma-accent",
                    // Proposals get a dashed outline, never a ramp colour: the
                    // ramp encodes human-agreed coverage, and tinting it with
                    // unreviewed machine output would overstate coverage
                    // visually in exactly the way the status field prevents
                    // numerically.
                    proposed > 0 && hovered !== key && "ring-1 ring-dashed ring-dharma-accent/60",
                  )}
                >
                  {pct > 0 ? `${Math.round(pct)}%` : "–"}
                  {proposed > 0 && (
                    <span className="absolute right-0.5 top-0.5 text-[9px] font-medium text-dharma-accent">
                      +{proposed}
                    </span>
                  )}
                  {hovered === key && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-dharma-border bg-dharma-surface px-2 py-1 text-[11px] font-normal text-dharma-ink border border-dharma-border">
                      {cell?.mappingCount ?? 0} mapping{(cell?.mappingCount ?? 0) === 1 ? "" : "s"}
                      {proposed > 0 && ` · ${proposed} proposed`} · click to view
                    </div>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-2 text-[11px] text-dharma-ink-secondary">
        <span>Coverage:</span>
        <div className="flex items-center gap-0.5">
          <span className="h-3 w-3 rounded-sm bg-dharma-surface-hover" />
          {BUCKET_CLASSES.map((c, i) => (
            <span key={i} className={cn("h-3 w-3 rounded-sm", c)} />
          ))}
        </div>
        <span>0% → 100%</span>
        <span className="ml-3 flex items-center gap-1">
          <span className="h-3 w-3 rounded-sm ring-1 ring-dashed ring-dharma-accent/60" />
          proposed, pending review
        </span>
      </div>
    </div>
  );
}
