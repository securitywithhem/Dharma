'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { Route } from 'next';

interface Framework {
  id: string;
  name: string;
  version: string;
  progress: number;
  controlCount: number;
  compliantCount: number;
}

interface FrameworkProgressCardsProps {
  frameworks: Framework[];
}

/** Same thresholds as the overall readiness band, so the two never disagree. */
function bandFor(progress: number) {
  if (progress >= 80) return { fill: 'bg-success', text: 'text-success', label: 'On track' };
  if (progress >= 60) return { fill: 'bg-warning', text: 'text-warning', label: 'Needs work' };
  return { fill: 'bg-critical', text: 'text-critical', label: 'At risk' };
}

export function FrameworkProgressCards({ frameworks }: FrameworkProgressCardsProps) {
  if (frameworks.length === 0) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-data text-muted-foreground">
            No certification goals yet.{' '}
            <Link
              href={'/dashboard/frameworks' as Route}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Pick a framework
            </Link>{' '}
            to start tracking readiness.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {frameworks.map((framework) => {
        const band = bandFor(framework.progress);
        const pct = Math.min(Math.max(framework.progress, 0), 100);

        return (
          <Card
            key={framework.id}
            className="group transition-shadow duration-150 hover:shadow-md"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={'/dashboard/frameworks' as Route}
                    className="flex items-center gap-1 rounded-sm font-medium tracking-[-0.01em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="truncate">{framework.name}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                  </Link>
                  <p className="mt-0.5 font-mono text-micro text-muted-foreground">
                    v{framework.version}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    data-numeric
                    className="font-display text-2xl font-semibold leading-none tabular-nums text-foreground"
                  >
                    {pct}%
                  </p>
                  <p className={cn('mt-1 text-micro font-medium', band.text)}>{band.label}</p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${framework.name} readiness ${pct}%`}
              >
                <div className={cn('h-full rounded-full', band.fill)} style={{ width: `${pct}%` }} />
              </div>
              <p data-numeric className="text-micro tabular-nums text-muted-foreground">
                {framework.compliantCount} of {framework.controlCount} controls compliant
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
