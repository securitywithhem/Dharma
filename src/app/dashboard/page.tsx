'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CardRow, Section } from '@/components/ui/section';
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
 *
 * ---------------------------------------------------------------------------
 * LAYOUT CONTRACT — every row below is full width. There are exactly four.
 *
 *   Row 1  Framework status    full width, responsive N-up grid
 *   Row 2  Top action items (2/3) + Recent activity (1/3)   deliberately split
 *   Row 3  Domain gap analysis  full width, standalone
 *   Row 4  Workspace            full width, cards split evenly, equal height
 *
 * Width is NOT the thing to get right here — every row inherits it from the
 * single max-w-[88rem] container below, and always did. What broke twice was
 * TRACK OCCUPANCY: a `lg:grid-cols-3` reserves three columns whether or not
 * three children render, so Row 3 (one col-span-2 child) and Row 4 (a child
 * that returns null when it has no data) both rendered a full-width grid with
 * a permanently empty third column, which reads as a narrow row.
 *
 * Rows whose child count is fixed may use explicit columns. Rows whose child
 * count depends on data MUST use <CardRow>, whose auto-fit tracks collapse when
 * a child does not render. Enforced by tests/e2e/dashboard-layout.spec.ts.
 * ---------------------------------------------------------------------------
 */

function DashboardSkeleton() {
  // Mirrors the real layout so the page does not reflow when data lands.
  return (
    <div className="mx-auto max-w-[88rem] space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-96" />
      </div>
      {/* Every row below goes through the SAME primitive and track floor as the
          real thing, so the skeleton cannot drift out of step and make the page
          reflow when data lands — which is the one job it has. */}
      <CardRow minCardWidth="18rem">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </CardRow>
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(22rem, 100%), 1fr))' }}
      >
        <Skeleton className="h-64 w-full [grid-column:span_2]" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-72 w-full" />
      <CardRow>
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </CardRow>
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
    <div className="mx-auto max-w-[88rem] space-y-4">
      <header>
        <h1 className="font-display text-display-sm font-semibold text-dharma-ink">
          Compliance status
        </h1>
        <p className="mt-1 text-data text-dharma-ink-secondary">
          Your current readiness across frameworks, recent activity, and immediate action items.
        </p>
      </header>

      {/* Row 1 — framework readiness, worst-first. */}
      <Section title="Framework status" id="frameworks-status">
        <FrameworkStatusGrid frameworks={stats.frameworks} />
      </Section>

      {/* Row 2 — deliberately asymmetric 2/3 + 1/3. Fixed child count, so
          explicit columns are correct here. */}
      {/* Container-relative, like every other row. `lg:grid-cols-3` fired on a
          WINDOW width of 1024 while the container there is only ~736px, which
          squeezed the activity column to ~235px — narrower than its own nowrap
          timestamp. auto-fit asks the real container; the 2-track span only
          applies once three tracks genuinely fit, and below that both children
          take one track each and stack.

          min-w-0 on both: grid items default to min-width:auto and otherwise
          refuse to shrink below their content. */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(22rem, 100%), 1fr))' }}
      >
        <div className="min-w-0 [grid-column:span_2]">
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

      {/* Row 3 — standalone full-width row. Was a lg:grid-cols-3 holding a single
          lg:col-span-2 child, i.e. a third of the row was empty by construction.
          titleHidden because the Card inside already renders the visible title. */}
      <Section title="Domain gap analysis" id="domain-gap" titleHidden>
        <DomainGapHeatmap domains={stats.domains} />
      </Section>

      {/* Row 4 — ImportedFrameworksCard returns null when the org has no imports,
          so the child count is 2 or 3 depending on data. CardRow's auto-fit
          tracks collapse the missing one instead of leaving a dead column. */}
      <Section title="Workspace" id="workspace">
        <CardRow>
          <QuickActionsCard />
          <ImportedFrameworksCard />
          <ExportReportCard />
        </CardRow>
      </Section>
    </div>
  );
}
