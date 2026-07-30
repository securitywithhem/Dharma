'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight, Layers } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressRing } from '@/components/ui/progress-ring';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { getFrameworkSeverity, severityNeedsAttention } from '@/lib/compliance/severity';
import { cn } from '@/lib/utils';

import type { FrameworkSeverity } from '@/lib/compliance/severity';
import type { Route } from 'next';

/**
 * Framework readiness card.
 *
 * Replaces two divergent implementations: an inlined copy in
 * app/dashboard/page.tsx and the (imported but unrendered) FrameworkProgressCards.
 * They banded severity differently — 50/80 vs 60/80 — so the same framework
 * could read "At risk" in one and "Needs work" in the other. Both are gone;
 * banding now comes from lib/compliance/severity.
 *
 * Layout: one horizontal band — ring, then name/meta/chips — instead of the
 * previous four stacked blocks with a percentage floating diagonally opposite
 * its own progress bar. That diagonal was the source of the dead space; the
 * ring closes it by putting the number inside the indicator.
 */

/**
 * Version strings in this data set are not all numbers — SOC 2 seeds "Type II",
 * which the previous unconditional `v{version}` rendered as the nonsense
 * "vType II". Prefix only when the string actually starts with a digit.
 */
function formatVersion(version: string): string {
  return /^\d/.test(version) ? `v${version}` : version;
}

export interface FrameworkStatusCardProps {
  id: string;
  name: string;
  version: string;
  progress: number;
  controlCount: number;
  compliantCount: number;
  /** Supplied by dashboardRouter. Recomputed locally if a caller omits it. */
  severity?: FrameworkSeverity;
}

export function FrameworkStatusCard({
  name,
  version,
  progress,
  controlCount,
  compliantCount,
  severity,
}: FrameworkStatusCardProps) {
  const pct = Math.min(Math.max(progress, 0), 100);
  const band = severity ?? getFrameworkSeverity(pct);
  const outstanding = Math.max(controlCount - compliantCount, 0);

  return (
    <Card
      density="compact"
      className={cn(
        'group transition-colors duration-dharma-fast ease-dharma hover:bg-dharma-surface-hover',
        // Only bands that need attention carry a coloured rule. A green rule on
        // a healthy card spends the reader's severity channel announcing that
        // nothing is wrong — the palette is meant to stay quiet until it isn't.
        severityNeedsAttention(band) && 'border-l-2',
        band === 'critical' && 'border-l-dharma-danger',
        band === 'partial' && 'border-l-dharma-warning',
      )}
    >
      <CardContent className="flex items-center gap-3.5 pt-3.5">
        <ProgressRing value={pct} severity={band} label={`${name} readiness`} />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Link
              href={'/dashboard/frameworks' as Route}
              className="flex min-w-0 items-center gap-1 rounded-dharma-sm font-medium tracking-[-0.01em] text-dharma-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
            >
              <span className="truncate">{name}</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-dharma-ink-secondary opacity-0 transition-opacity duration-dharma-fast group-hover:opacity-100"
                aria-hidden
              />
            </Link>

            {/*
              TODO(data): the seed contains TWO duplicated framework pairs, not
              one — "ISO 27001" (v2022, 4 controls) vs "ISO 27001:2022" (v1.0,
              24 controls), and "SOC 2" (Type II, 0 controls) vs "SOC 2 Type II"
              (v1.0, 28 controls). This version chip makes them distinguishable,
              but it is a mitigation, not a fix: the duplication is a seed-data
              defect and belongs in the framework seed, not papered over here.
              The empty "SOC 2" row is the worse of the two — it renders a card
              carrying no data at all. Flagged to the owner 2026-07-30.
            */}
            <span className="shrink-0 rounded-dharma-sm bg-dharma-surface-hover px-1.5 py-0.5 font-mono text-[10px] leading-none text-dharma-ink-secondary">
              {formatVersion(version)}
            </span>
          </div>

          <p data-numeric className="text-micro tabular-nums text-dharma-ink-secondary">
            {compliantCount} of {controlCount} controls
            {outstanding > 0 && <> · {outstanding} outstanding</>}
          </p>

          {/*
            Key gaps as one inline chip row rather than a stacked list under a
            divider rule. The previous version also printed an ORGANISATION-WIDE
            critical-gap count inside every framework card, so all six cards
            claimed the same "12 critical gaps" regardless of framework. That
            number was wrong per-card and has been removed; org-wide gap
            counts belong in the Domain gap analysis panel, where they are true.
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={band} withDot />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export interface FrameworkStatusGridProps {
  frameworks: FrameworkStatusCardProps[];
}

export function FrameworkStatusGrid({ frameworks }: FrameworkStatusGridProps) {
  if (frameworks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Layers}
          title="No frameworks tracked yet"
          description="Pick a certification goal and Dharma will start scoring your control coverage against it."
          action={{ label: 'Browse frameworks', href: '/dashboard/frameworks' }}
        />
      </Card>
    );
  }

  // Worst-first. A reader opening this page is looking for what to fix, not for
  // the order the frameworks happened to be created in.
  const ranked = [...frameworks].sort((a, b) => a.progress - b.progress);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {ranked.map((framework) => (
        <FrameworkStatusCard key={framework.id} {...framework} />
      ))}
    </div>
  );
}
