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
 */
function getProgressStatus(pct: number): {
  colour: string;
  progressColour: string;
  label: string;
} {
  if (pct >= 80) {
    return {
      colour: "text-emerald-600 dark:text-emerald-400",
      progressColour: "[&>div]:bg-emerald-500",
      label: "On Track",
    };
  }

  if (pct >= 40) {
    return {
      colour: "text-amber-600 dark:text-amber-400",
      progressColour: "[&>div]:bg-amber-500",
      label: "In Progress",
    };
  }

  return {
    colour: "text-rose-500 dark:text-rose-400",
    progressColour: "[&>div]:bg-rose-500",
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
  const status = getProgressStatus(progressPercentage);
  const notStarted =
    controlCount - compliantCount - inProgressCount - notApplicableCount;

  return (
    <Link
      href={`/dashboard/frameworks/${id}`}
      aria-label={`View ${name} compliance framework`}
    >
      <Card className="group relative flex h-full flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-primary/30">
        {/* Subtle top accent */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-1 rounded-t-xl",
            progressPercentage >= 80
              ? "bg-emerald-500"
              : progressPercentage >= 40
                ? "bg-amber-500"
                : "bg-rose-500",
          )}
          aria-hidden="true"
        />

        <CardHeader className="pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                <h3
                  className="font-semibold text-base leading-tight truncate"
                  title={name}
                >
                  {name}
                </h3>
              </div>
              {description && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
                  {description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="text-xs whitespace-nowrap">
                v{version}
              </Badge>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          {/* Progress section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">
                Overall Compliance
              </span>
              <span className={cn("text-xl font-bold tabular-nums", status.colour)}>
                {Math.round(progressPercentage)}%
              </span>
            </div>
            <Progress
              value={progressPercentage}
              className={cn("h-2.5", status.progressColour)}
              aria-label={`${name} compliance: ${Math.round(progressPercentage)}%`}
            />
            <p className={cn("text-xs font-medium", status.colour)}>
              {status.label}
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatPill
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
              label="Compliant"
              value={compliantCount}
              total={controlCount}
              valueClass="text-emerald-600 dark:text-emerald-400"
            />
            <StatPill
              icon={<Clock className="h-3.5 w-3.5 text-amber-500" />}
              label="In Progress"
              value={inProgressCount}
              total={controlCount}
              valueClass="text-amber-600 dark:text-amber-400"
            />
            <StatPill
              icon={<Circle className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Not Started"
              value={notStarted}
              total={controlCount}
              valueClass="text-foreground"
            />
            <StatPill
              icon={<Circle className="h-3.5 w-3.5 text-muted-foreground/50" />}
              label="N/A"
              value={notApplicableCount}
              total={controlCount}
              valueClass="text-muted-foreground"
            />
          </div>

          {/* Total count footer */}
          <p className="text-xs text-muted-foreground border-t border-border/50 pt-3 text-center">
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
    <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
      {icon}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={cn("text-sm font-bold tabular-nums", valueClass)}>
          {value}
          <span className="text-xs font-normal text-muted-foreground">
            /{total}
          </span>
        </p>
      </div>
    </div>
  );
}
