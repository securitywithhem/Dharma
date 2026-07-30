'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ActionItemRow } from '@/components/dashboard/ActionItemRow';
import { FrameworkStatusGrid } from '@/components/dashboard/FrameworkStatusCard';
import { DomainGapHeatmap } from '@/components/dashboard/DomainGapHeatmap';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { QuickActionsCard } from '@/components/dashboard/QuickActionsCard';
import { ExportReportCard } from '@/components/report/ExportReportCard';
import { ImportedFrameworksCard } from '@/components/dashboard/ImportedFrameworksCard';
import { api } from '@/hooks/trpc';

/**
 * No entrance animation anywhere on this page. The previous version staggered
 * every section in on a 0.1–0.5s delay ladder, which meant an operator opening
 * their console several times a day waited half a second for a layout they had
 * already memorised. Motion here is reserved for interaction feedback.
 */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[0.9375rem] font-semibold tracking-[-0.01em]">{children}</h2>;
}

function DashboardSkeleton() {
  // Mirrors the real layout so the page does not reflow when data lands.
  return (
    <div className="mx-auto max-w-[88rem] space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 w-full lg:col-span-2" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function LoadFailure({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-[88rem]">
      <Card className="border-dharma-danger">
        <CardContent className="flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-dharma-danger-text" aria-hidden />
          <div>
            <p className="text-data font-medium text-dharma-ink">
              Could not load your compliance status
            </p>
            <p className="mt-1 text-data text-dharma-ink-secondary">
              {message ?? 'The dashboard data request did not complete. Refresh to try again.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading, error } = api.dashboard.getStats.useQuery();

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <LoadFailure message={error.message} />;
  if (!stats) return <LoadFailure />;

  // Five, not three. The row is now a scan line rather than a padded block, so
  // two more fit in less vertical space than the old three occupied.
  const nextActions = stats.topIncompleteControls.slice(0, 5);

  return (
    <div className="mx-auto max-w-[88rem] space-y-6">
      <header>
        <h1 className="font-display text-display-sm font-semibold text-dharma-ink">
          Compliance status
        </h1>
        <p className="mt-1 text-data text-dharma-ink-secondary">
          Your current readiness across frameworks, recent activity, and immediate action items.
        </p>
      </header>

      {/* PRIMARY: framework readiness, worst-first. */}
      <section aria-labelledby="frameworks-status">
        <SectionHeading>
          <span id="frameworks-status">Framework status</span>
        </SectionHeading>
        <FrameworkStatusGrid frameworks={stats.frameworks} />
      </section>

      {/* SECONDARY: Action Items + Recent Activity — side by side */}
      {/* min-w-0 on the grid children: grid items default to min-width:auto, so
          without it a wide child cannot shrink and pushes the track past the
          viewport instead of wrapping. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <h2 className="text-base font-semibold text-dharma-ink">Top action items</h2>
              <p className="mt-1 text-data text-dharma-ink-secondary">
                Controls with the thinnest evidence, highest priority first.
              </p>
            </CardHeader>
            <CardContent>
              {nextActions.length === 0 ? (
                <div className="py-6 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-dharma-success-text" aria-hidden />
                  <p className="mt-2 text-data font-medium text-dharma-ink">Nothing outstanding</p>
                  <p className="mt-1 text-micro text-dharma-ink-secondary">
                    Every tracked control has evidence attached.
                  </p>
                </div>
              ) : (
                /*
                  TODO(data): the seeded organisation returns several controls
                  literally titled "Test Control", which is why this list reads
                  as three identical rows in the current screenshots. That is
                  placeholder seed data, not a rendering fault — replace it in
                  the framework seed. Flagged to the owner 2026-07-30.
                */
                /* No negative margin. A `-mx-2` bleed to let the row hover
                   reach the card edge makes the list wider than its own
                   container, which at 390px pushed the whole grid column past
                   the viewport — the row's own px-2 gives the same inset
                   without overflowing. Caught by the 390px e2e check. */
                <ul className="divide-y divide-dharma-border">
                  {nextActions.map((control, index) => (
                    <ActionItemRow key={control.id} item={control} rank={index + 1} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <RecentActivityFeed activities={stats.recentActivity.slice(0, 5)} />
        </div>
      </div>

      {/* TERTIARY: Domain Analysis + Workspace — secondary context */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <DomainGapHeatmap domains={stats.domains} />
        </div>
      </div>

      <section aria-labelledby="workspace">
        <SectionHeading>
          <span id="workspace">Workspace</span>
        </SectionHeading>
        <div className="grid gap-4 lg:grid-cols-3">
          <QuickActionsCard />
          <ImportedFrameworksCard />
          <ExportReportCard />
        </div>
      </section>
    </div>
  );
}
