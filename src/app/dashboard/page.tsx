'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { OverallReadinessScore } from '@/components/dashboard/OverallReadinessScore';
import { FrameworkProgressCards } from '@/components/dashboard/FrameworkProgressCards';
import { DomainGapHeatmap } from '@/components/dashboard/DomainGapHeatmap';
import { RecentActivityFeed } from '@/components/dashboard/RecentActivityFeed';
import { QuickActionsCard } from '@/components/dashboard/QuickActionsCard';
import { ExportReportCard } from '@/components/report/ExportReportCard';
import { ImportedFrameworksCard } from '@/components/dashboard/ImportedFrameworksCard';
import { api } from '@/hooks/trpc';
import { cn } from '@/lib/utils';

import type { Route } from 'next';

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
      <Card className="border-critical/30">
        <CardContent className="flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden />
          <div>
            <p className="text-data font-medium text-foreground">
              Could not load your compliance status
            </p>
            <p className="mt-1 text-data text-muted-foreground">
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

  const nextActions = stats.topIncompleteControls.slice(0, 3);

  // Count critical and high gaps across all frameworks for summary
  const gapCounts = stats.domains.reduce(
    (acc, domain) => {
      if (domain.gap === 'HIGH') acc.critical += 1;
      else if (domain.gap === 'MEDIUM') acc.high += 1;
      return acc;
    },
    { critical: 0, high: 0 }
  );

  return (
    <div className="mx-auto max-w-[88rem] space-y-6">
      <header>
        <h1 className="font-display text-display-sm font-semibold text-foreground">
          Compliance status
        </h1>
        <p className="mt-1 text-data text-muted-foreground">
          Your current readiness across frameworks, recent activity, and immediate action items.
        </p>
      </header>

      {/* PRIMARY: Framework Status Cards Grid — one card per framework with readiness, gaps */}
      <section aria-labelledby="frameworks-status">
        <SectionHeading>
          <span id="frameworks-status">Framework Status</span>
        </SectionHeading>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stats.frameworks.map((framework) => {
            // Get domains for this framework to show gaps
            const frameworkDomains = stats.domains; // All domains in one org
            const compliant = framework.compliantCount;
            const total = framework.controlCount;
            const progress = framework.progress;

            // Determine status color based on progress
            let statusColor = 'bg-success';
            let statusLabel = 'On track';
            if (progress < 50) {
              statusColor = 'bg-critical';
              statusLabel = 'At risk';
            } else if (progress < 80) {
              statusColor = 'bg-warning';
              statusLabel = 'Needs work';
            }

            return (
              <Card
                key={framework.id}
                className="group relative overflow-hidden border-l-4 transition-shadow duration-150 hover:shadow-md"
                style={{
                  borderLeftColor:
                    progress >= 80
                      ? 'hsl(var(--success))'
                      : progress >= 50
                        ? 'hsl(var(--warning))'
                        : 'hsl(var(--critical))',
                }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={'/dashboard/frameworks' as Route}
                        className="flex items-center gap-2 rounded-sm font-medium tracking-[-0.01em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{framework.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                      </Link>
                      <p className="mt-1 font-mono text-micro text-muted-foreground">
                        v{framework.version}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-2xl font-semibold leading-none tabular-nums text-foreground">
                        {progress}%
                      </p>
                      <p className={cn('mt-1 text-micro font-medium', {
                        'text-success': progress >= 80,
                        'text-warning': progress >= 50 && progress < 80,
                        'text-critical': progress < 50,
                      })}>
                        {statusLabel}
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Progress bar */}
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="meter"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${framework.name} readiness ${progress}%`}
                  >
                    <div
                      className={cn('h-full rounded-full', {
                        'bg-success': progress >= 80,
                        'bg-warning': progress >= 50 && progress < 80,
                        'bg-critical': progress < 50,
                      })}
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  {/* Control count */}
                  <p data-numeric className="text-micro tabular-nums text-muted-foreground">
                    {compliant} of {total} controls
                  </p>

                  {/* Gap summary - key findings */}
                  {progress < 100 && (
                    <div className="space-y-1.5 border-t border-border pt-2">
                      <p className="text-micro font-medium text-foreground">Key gaps:</p>
                      <p className="text-micro text-muted-foreground">
                        {total - compliant} control{total - compliant === 1 ? '' : 's'} incomplete
                      </p>
                      {gapCounts.critical > 0 && (
                        <p className="flex items-center gap-1.5 text-micro">
                          <AlertCircle className="h-3 w-3 shrink-0 text-critical" />
                          <span className="text-critical font-medium">{gapCounts.critical} critical gap{gapCounts.critical === 1 ? '' : 's'}</span>
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* SECONDARY: Action Items + Recent Activity — side by side */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Action Items Card (2/3 width) */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <h2 className="text-base font-semibold text-foreground">
                Top action items
              </h2>
              <p className="mt-1 text-data text-muted-foreground">
                Priority tasks to improve your compliance posture
              </p>
            </CardHeader>
            <CardContent>
              {nextActions.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-success" aria-hidden />
                  <p className="mt-2 text-data font-medium text-foreground">All set!</p>
                  <p className="mt-1 text-micro text-muted-foreground">
                    No priority actions. Review your compliance status regularly.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {nextActions.map((control, index) => (
                    <Link
                      key={control.id}
                      href={'/dashboard/controls' as Route}
                      className="group block rounded-lg border border-border bg-muted/30 p-3.5 transition-all duration-150 hover:border-primary/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-micro font-semibold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-data font-medium text-foreground">
                            {control.title}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 truncate text-micro text-muted-foreground">
                            <span>{control.frameworkName}</span>
                            <span>·</span>
                            <span>{control.domain}</span>
                          </p>
                          <p className="mt-1 text-micro text-muted-foreground">
                            {control.evidenceCount === 0 ? (
                              <span className="font-medium text-critical">No evidence yet</span>
                            ) : (
                              <span data-numeric>
                                {control.evidenceCount} evidence item{control.evidenceCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </p>
                        </div>
                        <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity Feed (1/3 width) */}
        <div>
          <RecentActivityFeed activities={stats.recentActivity.slice(0, 5)} />
        </div>
      </div>

      {/* TERTIARY: Domain Analysis + Workspace — secondary context */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
