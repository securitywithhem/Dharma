'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { GapBadge } from '@/components/ui/severity-badge';
import { cn } from '@/lib/utils';
import { LayoutGrid } from 'lucide-react';

import type { DomainGap } from '@/lib/compliance/severity';

interface Domain {
  name: string;
  controlCount: number;
  compliantCount: number;
  evidenceCount: number;
  policyCount: number;
  completionPercentage: number;
  gap: DomainGap;
}

interface DomainGapHeatmapProps {
  domains: Domain[];
}

/**
 * How many rows render before the reader has to ask for more. Twelve identical
 * rows in a single scroll is not a ranking, it is a list — the top slice is
 * what makes the ordering legible as a priority order.
 */
const COLLAPSED_COUNT = 5;

/**
 * Completion is a magnitude compared across categories, so the mark is a
 * sorted bar: length is the channel a reader can actually judge precisely.
 * Colour is a redundant *sequential* encoding of the same value — one hue,
 * light→dark. The previous version filled every bar with the identical
 * `from-amber-600 to-emerald-600` gradient, which swept through colour
 * regardless of the value it was supposed to represent.
 */
function seqStep(pct: number): string {
  if (pct >= 80) return 'bg-seq-5';
  if (pct >= 60) return 'bg-seq-4';
  if (pct >= 40) return 'bg-seq-3';
  if (pct >= 20) return 'bg-seq-2';
  return 'bg-seq-1';
}

export function DomainGapHeatmap({ domains }: DomainGapHeatmapProps) {
  const [expanded, setExpanded] = React.useState(false);

  // Worst-first. A compliance reader is looking for what to fix, not for an
  // alphabetical index. Matches the "lowest first" subheading below.
  const sortedDomains = React.useMemo(
    () => [...domains].sort((a, b) => a.completionPercentage - b.completionPercentage),
    [domains],
  );

  const hiddenCount = Math.max(sortedDomains.length - COLLAPSED_COUNT, 0);
  const visibleDomains = expanded ? sortedDomains : sortedDomains.slice(0, COLLAPSED_COUNT);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Domain gap analysis</CardTitle>
          <CardDescription>
            Control coverage by domain, lowest first.
          </CardDescription>
        </div>

        {/* Sequential legend — required whenever colour carries a value. */}
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span className="text-micro text-dharma-ink-secondary">0%</span>
          <div className="flex overflow-hidden rounded-sm">
            {['bg-seq-1', 'bg-seq-2', 'bg-seq-3', 'bg-seq-4', 'bg-seq-5'].map((step) => (
              <span key={step} className={cn('h-2 w-4', step)} aria-hidden />
            ))}
          </div>
          <span className="text-micro text-dharma-ink-secondary">100%</span>
        </div>
      </CardHeader>

      <CardContent>
        {sortedDomains.length === 0 ? (
          <EmptyState
            compact
            icon={LayoutGrid}
            title="No domains scored yet"
            description="Domains appear once a framework is imported and its controls are grouped."
            action={{ label: 'Add a framework', href: '/dashboard/frameworks' }}
          />
        ) : (
          <ul className="divide-y divide-dharma-border">
            {visibleDomains.map((domain) => (
              <li
                key={domain.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5"
                title={`${domain.name} — ${domain.compliantCount}/${domain.controlCount} controls, ${domain.evidenceCount} evidence, ${domain.policyCount} policies`}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-data font-medium text-dharma-ink">
                      {domain.name}
                    </span>
                    <span
                      data-numeric
                      className="shrink-0 text-data font-semibold tabular-nums text-dharma-ink"
                    >
                      {domain.completionPercentage}%
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-dharma-surface-hover">
                    <div
                      className={cn('h-full rounded-full', seqStep(domain.completionPercentage))}
                      style={{ width: `${Math.min(Math.max(domain.completionPercentage, 0), 100)}%` }}
                    />
                  </div>

                  <p className="mt-1 text-micro text-dharma-ink-secondary">
                    <span data-numeric className="tabular-nums">
                      {domain.compliantCount}/{domain.controlCount}
                    </span>{' '}
                    controls ·{' '}
                    <span data-numeric className="tabular-nums">
                      {domain.evidenceCount}
                    </span>{' '}
                    evidence ·{' '}
                    <span data-numeric className="tabular-nums">
                      {domain.policyCount}
                    </span>{' '}
                    policies
                  </p>
                </div>

                {/* Status ships as a labelled chip, never colour alone. */}
                <GapBadge gap={domain.gap} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="mt-2 w-full rounded-dharma-md border-t border-dharma-border pt-2.5 text-micro font-medium text-dharma-accent-on-tint transition-colors duration-dharma-fast ease-dharma hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
          >
            {expanded ? 'Show top 5 only' : `Show all ${sortedDomains.length} domains`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
