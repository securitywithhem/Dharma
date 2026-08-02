"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreGauge } from "@/components/readiness/ScoreGauge";
import { api } from "@/hooks/trpc";
import { cn } from "@/lib/utils";

interface FrameworkCardProps {
  id: string;
  name: string;
  version: string;
  description?: string;
  progressPercentage: number;
  controlCount: number;
  compliantCount: number;
  inProgressCount: number;
  notApplicableCount: number;
}

/**
 * Returns a colour token and label based on progress percentage.
 *
 * Uses the --severity-* ramp rather than raw Tailwind palette values: a gap in
 * framework progress is a finding, and should be coloured like one. The old
 * emerald/amber/rose hardcodes drifted from the badge ramp and put
 * text-dharma-danger-text on card at 3.61:1, below WCAG AA.
 *
 * Bands intentionally match ScoreGauge's bandFor().
 */
function getProgressStatus(pct: number, controlCount: number): {
  colour: string;
  progressColour: string;
  label: string;
} {
  // A framework with no controls yet is not "0% compliant" — there is nothing
  // to be compliant with. Colouring it danger-red made an unconfigured
  // framework indistinguishable from one failing every control it has, so it
  // gets its own neutral state.
  if (controlCount === 0) {
    return {
      colour: "text-dharma-ink-secondary",
      progressColour: "[&>div]:bg-dharma-border-strong",
      label: "Not yet configured",
    };
  }

  if (pct >= 80) {
    return {
      colour: "text-dharma-info",
      progressColour: "[&>div]:bg-dharma-info",
      label: "On Track",
    };
  }

  if (pct >= 40) {
    return {
      colour: "text-dharma-warning",
      progressColour: "[&>div]:bg-dharma-warning",
      label: "In Progress",
    };
  }

  return {
    colour: "text-dharma-danger",
    progressColour: "[&>div]:bg-dharma-danger",
    label: "Needs Attention",
  };
}

export function FrameworkCard({
  id,
  name,
  version,
  description,
  progressPercentage,
  controlCount,
  compliantCount,
  inProgressCount,
  notApplicableCount,
}: FrameworkCardProps) {
  const isUnconfigured = controlCount === 0;
  const status = getProgressStatus(progressPercentage, controlCount);
  const notStarted =
    controlCount - compliantCount - inProgressCount - notApplicableCount;

  return (
    <Link
      href={`/dashboard/frameworks/${id}`}
      aria-label={`View ${name} compliance framework`}
    >
      <Card className="group relative flex h-full flex-col overflow-hidden transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border border-dharma-border hover:border-dharma-accent">
        {/* Subtle top accent */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-1 rounded-t-xl",
            isUnconfigured
              ? "bg-dharma-border-strong"
              : progressPercentage >= 80
                ? "bg-dharma-info"
                : progressPercentage >= 40
                  ? "bg-dharma-warning"
                  : "bg-dharma-danger",
          )}
          aria-hidden="true"
        />

        <CardHeader className="pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-dharma-accent-on-tint" />
                <h3
                  className="font-semibold text-base leading-tight truncate"
                  title={name}
                >
                  {name}
                </h3>
              </div>
              {description && (
                <p className="text-xs text-dharma-ink-secondary line-clamp-2 pl-6">
                  {description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <ReadinessScoreBadge frameworkId={id} />
              <Badge variant="outline" className="text-xs whitespace-nowrap">
                v{version}
              </Badge>
              <ArrowRight className="h-4 w-4 text-dharma-ink-secondary transition-transform duration-150 ease-out group-hover:translate-x-0.5" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {/* Progress section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-dharma-ink-secondary">
                Overall Compliance
              </span>
              <span className={cn("text-xl font-bold tabular-nums", status.colour)}>
                {/* An em-dash, not "0%": a framework with no controls has no
                    compliance percentage to report. */}
                {isUnconfigured ? "—" : `${Math.round(progressPercentage)}%`}
              </span>
            </div>
            <Progress
              value={isUnconfigured ? 0 : progressPercentage}
              className={cn("h-2.5", status.progressColour)}
              aria-label={
                isUnconfigured
                  ? `${name}: no controls configured yet`
                  : `${name} compliance: ${Math.round(progressPercentage)}%`
              }
            />
            <p className={cn("text-xs font-medium", status.colour)}>
              {status.label}
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatPill
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-dharma-success-text" />}
              label="Compliant"
              value={compliantCount}
              total={controlCount}
              valueClass="text-dharma-success-text"
            />
            <StatPill
              icon={<Clock className="h-3.5 w-3.5 text-dharma-ink" />}
              label="In Progress"
              value={inProgressCount}
              total={controlCount}
              valueClass="text-dharma-ink"
            />
            <StatPill
              icon={<Circle className="h-3.5 w-3.5 text-dharma-ink-secondary" />}
              label="Not Started"
              value={notStarted}
              total={controlCount}
              valueClass="text-dharma-ink"
            />
            <StatPill
              icon={<Circle className="h-3.5 w-3.5 text-dharma-ink-secondary" />}
              label="N/A"
              value={notApplicableCount}
              total={controlCount}
              valueClass="text-dharma-ink-secondary"
            />
          </div>

          {/* Total count footer */}
          <p className="text-xs text-dharma-ink-secondary border-t border-dharma-border pt-3 text-center">
            {controlCount} total control{controlCount !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

// ------------------------------------------------------------------
// Helper sub-component
// ------------------------------------------------------------------

/** Compact Audit Readiness Score badge (Phase 6 Part 3) for a frameworks-list card. */
function ReadinessScoreBadge({ frameworkId }: { frameworkId: string }) {
  const { data } = api.readiness.getScore.useQuery({ frameworkId });

  if (!data || data.status === "computing") {
    return <Skeleton className="h-9 w-9 rounded-full" />;
  }

  return <ScoreGauge score={data.overallScore} size={36} strokeWidth={4} compact />;
}

function StatPill({
  icon,
  label,
  value,
  total,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total: number;
  valueClass: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-dharma-surface-hover px-3 py-2">
      {icon}
      <div className="min-w-0">
        <p className="text-xs text-dharma-ink-secondary truncate">{label}</p>
        <p className={cn("text-sm font-bold tabular-nums", valueClass)}>
          {value}
          <span className="text-xs font-normal text-dharma-ink-secondary">
            /{total}
          </span>
        </p>
      </div>
    </div>
  );
}
