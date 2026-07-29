'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Domain {
  name: string;
  controlCount: number;
  compliantCount: number;
  evidenceCount: number;
  policyCount: number;
  completionPercentage: number;
  gap: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

interface DomainGapHeatmapProps {
  domains: Domain[];
}

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

const gapVariant: Record<Domain['gap'], 'success' | 'warning' | 'critical' | 'secondary'> = {
  NONE: 'success',
  LOW: 'secondary',
  MEDIUM: 'warning',
  HIGH: 'critical',
};

export function DomainGapHeatmap({ domains }: DomainGapHeatmapProps) {
  // Worst-first. A compliance reader is looking for what to fix, not for an
  // alphabetical index.
  const sortedDomains = [...domains].sort(
    (a, b) => a.completionPercentage - b.completionPercentage,
  );

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
          <span className="text-micro text-muted-foreground">0%</span>
          <div className="flex overflow-hidden rounded-sm">
            {['bg-seq-1', 'bg-seq-2', 'bg-seq-3', 'bg-seq-4', 'bg-seq-5'].map((step) => (
              <span key={step} className={cn('h-2 w-4', step)} aria-hidden />
            ))}
          </div>
          <span className="text-micro text-muted-foreground">100%</span>
        </div>
      </CardHeader>

      <CardContent>
        {sortedDomains.length === 0 ? (
          <p className="py-6 text-center text-data text-muted-foreground">
            No domains scored yet. Add a certification goal to begin.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sortedDomains.map((domain) => (
              <li
                key={domain.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5"
                title={`${domain.name} — ${domain.compliantCount}/${domain.controlCount} controls, ${domain.evidenceCount} evidence, ${domain.policyCount} policies`}
              >
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-data font-medium text-foreground">
                      {domain.name}
                    </span>
                    <span
                      data-numeric
                      className="shrink-0 text-data font-semibold tabular-nums text-foreground"
                    >
                      {domain.completionPercentage}%
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', seqStep(domain.completionPercentage))}
                      style={{ width: `${Math.min(Math.max(domain.completionPercentage, 0), 100)}%` }}
                    />
                  </div>

                  <p className="mt-1 text-micro text-muted-foreground">
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
                <Badge variant={gapVariant[domain.gap]} className="shrink-0">
                  {domain.gap === 'NONE' ? 'No gap' : `${domain.gap.toLowerCase()} gap`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
