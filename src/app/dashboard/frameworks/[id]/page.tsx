"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ControlTable } from "./ControlTable";
import { DomainBreakdown } from "./DomainBreakdown";
import { cn } from "@/lib/utils";

interface FrameworkDetailPageProps {
  params: Promise<{ id: string }>;
}

function getProgressStatus(pct: number) {
  if (pct >= 80) return { label: "On Track", colour: "text-emerald-600 dark:text-emerald-400", bar: "[&>div]:bg-emerald-500" };
  if (pct >= 40) return { label: "In Progress", colour: "text-amber-600 dark:text-amber-400", bar: "[&>div]:bg-amber-500" };
  return { label: "Needs Attention", colour: "text-rose-500 dark:text-rose-400", bar: "[&>div]:bg-rose-500" };
}

export default function FrameworkDetailPage({ params }: FrameworkDetailPageProps) {
  const { id } = use(params);
  const utils = api.useUtils();

  const { data: framework, isLoading, isError, error } = api.framework.getById.useQuery(
    { id },
    { enabled: !!id },
  );

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold">Framework not found</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error?.message ?? "This framework does not exist or you do not have access to it."}
        </p>
        <Link
            href="/dashboard/frameworks"
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Frameworks
          </Link>
      </div>
    );
  }

  if (!framework) return null;

  const notStarted =
    framework.controlCount -
    framework.compliantCount -
    framework.controls.filter((c) => c.status === "IN_PROGRESS").length -
    framework.controls.filter((c) => c.status === "NOT_APPLICABLE").length;

  const inProgressCount = framework.controls.filter(
    (c) => c.status === "IN_PROGRESS",
  ).length;

  const notApplicableCount = framework.controls.filter(
    (c) => c.status === "NOT_APPLICABLE",
  ).length;

  const statusStyle = getProgressStatus(framework.progressPercentage);

  const handleStatusChanged = async () => {
    await utils.framework.getById.invalidate({ id });
    await utils.framework.list.invalidate();
  };

  return (
    <div className="space-y-8">
      {/* Breadcrumb + title */}
      <div className="space-y-3">
        <nav aria-label="Breadcrumb">
          <Link
            href="/dashboard/frameworks"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Compliance Frameworks
          </Link>
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{framework.name}</h1>
                <Badge variant="outline">v{framework.version}</Badge>
              </div>
              {framework.description && (
                <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
                  {framework.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Overall progress hero */}
      <Card className="overflow-hidden">
        <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/70">
          {/* Big percentage */}
          <div className="p-6 flex flex-col justify-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Overall Compliance
            </p>
            <div className="flex items-end gap-3 mt-2">
              <span
                className={cn("text-5xl font-bold tabular-nums", statusStyle.colour)}
              >
                {Math.round(framework.progressPercentage)}%
              </span>
              <Badge
                variant="outline"
                className={cn("mb-1.5 text-xs", statusStyle.colour)}
              >
                {statusStyle.label}
              </Badge>
            </div>
            <Progress
              value={framework.progressPercentage}
              className={cn("h-2 mt-3", statusStyle.bar)}
              aria-label={`${framework.name} overall compliance`}
            />
          </div>

          {/* Stats */}
          <div className="col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-border/70">
            {[
              {
                icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
                label: "Compliant",
                value: framework.compliantCount,
                colour: "text-emerald-600 dark:text-emerald-400",
              },
              {
                icon: <Clock className="h-4 w-4 text-amber-500" />,
                label: "In Progress",
                value: inProgressCount,
                colour: "text-amber-600 dark:text-amber-400",
              },
              {
                icon: <Circle className="h-4 w-4 text-muted-foreground" />,
                label: "Not Started",
                value: notStarted,
                colour: "text-foreground",
              },
              {
                icon: <Circle className="h-4 w-4 text-muted-foreground/50" />,
                label: "N/A",
                value: notApplicableCount,
                colour: "text-muted-foreground",
              },
            ].map(({ icon, label, value, colour }) => (
              <div key={label} className="flex flex-col justify-center p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  {icon}
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
                <p className={cn("text-3xl font-bold tabular-nums", colour)}>
                  {value}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  of {framework.controlCount}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Domain breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compliance by Domain</CardTitle>
        </CardHeader>
        <CardContent>
          <DomainBreakdown breakdown={framework.domainBreakdown} />
        </CardContent>
      </Card>

      {/* Controls table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Controls
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {framework.controlCount} total
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ControlTable
            controls={framework.controls}
            onStatusChanged={handleStatusChanged}
          />
        </CardContent>
      </Card>
    </div>
  );
}
