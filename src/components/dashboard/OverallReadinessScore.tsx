'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OverallReadinessScoreProps {
  score: number;
  totalControls: number;
  compliantControls: number;
}

/**
 * Readiness band. Thresholds are shared by the meter fill, the icon, and the
 * label so the state is never carried by colour alone — a requirement for the
 * ~8% of male users with a colour-vision deficiency, and for print/export.
 */
function bandFor(score: number) {
  if (score >= 80) {
    return {
      label: 'On track',
      icon: CheckCircle2,
      fill: 'bg-success',
      text: 'text-success',
      note: 'Readiness is at audit-ready level.',
    } as const;
  }
  if (score >= 60) {
    return {
      label: 'Needs work',
      icon: CircleDot,
      fill: 'bg-warning',
      text: 'text-warning',
      note: 'Close the open gaps before booking an audit.',
    } as const;
  }
  return {
    label: 'At risk',
    icon: AlertTriangle,
    fill: 'bg-critical',
    text: 'text-critical',
    note: 'Significant control coverage is missing.',
  } as const;
}

/**
 * A single headline figure is a stat tile, not a chart — so the number is the
 * mark. The previous donut made an exact value hard to read (arc length is a
 * poor magnitude channel) and animated a counter from 0, which delayed the one
 * number the user opened this page to see.
 */
export function OverallReadinessScore({
  score,
  totalControls,
  compliantControls,
}: OverallReadinessScoreProps) {
  const band = bandFor(score);
  const Icon = band.icon;
  const outstanding = Math.max(totalControls - compliantControls, 0);
  const pct = Math.min(Math.max(score, 0), 100);

  return (
    <section
      aria-label="Overall readiness"
      className="rounded-lg border border-border bg-card p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="label-eyebrow">Overall readiness</p>
          <div className="mt-2 flex items-baseline gap-2.5">
            <span
              data-numeric
              className="font-display text-display-lg font-semibold leading-none text-foreground"
            >
              {pct}
              <span className="text-display-sm text-muted-foreground">%</span>
            </span>
            <span className={cn('inline-flex items-center gap-1.5 text-data font-medium', band.text)}>
              <Icon className="h-4 w-4" aria-hidden />
              {band.label}
            </span>
          </div>
          <p className="mt-1.5 text-data text-muted-foreground">{band.note}</p>
        </div>

        {/* Supporting counts sit to the side, at a clearly lower weight than
            the headline — the old layout gave them equal billing. */}
        <dl className="flex gap-6">
          <div>
            <dt className="label-eyebrow">Compliant</dt>
            <dd data-numeric className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {compliantControls}
            </dd>
          </div>
          <div>
            <dt className="label-eyebrow">Outstanding</dt>
            <dd data-numeric className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {outstanding}
            </dd>
          </div>
          <div>
            <dt className="label-eyebrow">Total</dt>
            <dd data-numeric className="mt-1 text-xl font-semibold tabular-nums text-muted-foreground">
              {totalControls}
            </dd>
          </div>
        </dl>
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Readiness ${pct}%`}
      >
        <div className={cn('h-full rounded-full', band.fill)} style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}
