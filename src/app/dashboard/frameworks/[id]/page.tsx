"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Gauge,
  ListTree,
  Rows3,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { Route } from "next";
import { ControlTable } from "./ControlTable";
import { ControlTree } from "@/components/controls/ControlTree";
import { DomainBreakdown } from "./DomainBreakdown";
import { cn } from "@/lib/utils";

interface FrameworkDetailPageProps {
  params: Promise<{ id: string }>;
}

function getProgressStatus(pct: number) {
  if (pct >= 80) return { label: "On Track", colour: "text-dharma-success-text", bar: "[&>div]:bg-dharma-success-bg" };
  if (pct >= 40) return { label: "In Progress", colour: "text-dharma-ink", bar: "[&>div]:bg-dharma-warning-bg" };
  return { label: "Needs Attention", colour: "text-dharma-danger-text", bar: "[&>div]:bg-dharma-danger-bg" };
}

export default function FrameworkDetailPage({ params }: FrameworkDetailPageProps) {
  const { id } = use(params);
  const utils = api.useUtils();
  const [controlView, setControlView] = useState<"tree" | "flat">("tree");

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
        <ShieldAlert className="h-12 w-12 text-dharma-danger-text" />
        <h1 className="text-xl font-semibold">Framework not found</h1>
        <p className="text-sm text-dharma-ink-secondary max-w-sm">
          {error?.message ?? "This framework does not exist or you do not have access to it."}
        </p>
        <Link
            href="/dashboard/frameworks"
            className="inline-flex items-center gap-2 rounded-md border border-dharma-border px-4 py-2 text-sm font-medium hover:bg-dharma-surface-hover transition-colors"
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
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-dharma-ink-secondary hover:text-dharma-ink hover:bg-dharma-surface-hover transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Compliance Frameworks
          </Link>
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dharma-accent-tint">
              <Shield className="h-5 w-5 text-dharma-accent-on-tint" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{framework.name}</h1>
                <Badge variant="outline">v{framework.version}</Badge>
              </div>
              {framework.description && (
                <p className="text-sm text-dharma-ink-secondary mt-0.5 max-w-2xl">
                  {framework.description}
                </p>
              )}
            </div>
          </div>
          <Link href={`/dashboard/frameworks/${id}/readiness` as Route}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Gauge className="h-4 w-4" />
              Audit Readiness
            </Button>
          </Link>
        </div>
      </div>

      {/* Overall progress hero */}
      <Card className="overflow-hidden">
        <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/70">
          {/* Big percentage */}
          <div className="p-6 flex flex-col justify-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-dharma-ink-secondary">
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
                icon: <CheckCircle2 className="h-4 w-4 text-dharma-success-text" />,
                label: "Compliant",
                value: framework.compliantCount,
                colour: "text-dharma-success-text",
              },
              {
                icon: <Clock className="h-4 w-4 text-dharma-ink" />,
                label: "In Progress",
                value: inProgressCount,
                colour: "text-dharma-ink",
              },
              {
                icon: <Circle className="h-4 w-4 text-dharma-ink-secondary" />,
                label: "Not Started",
                value: notStarted,
                colour: "text-dharma-ink",
              },
              {
                icon: <Circle className="h-4 w-4 text-dharma-ink-secondary" />,
                label: "N/A",
                value: notApplicableCount,
                colour: "text-dharma-ink-secondary",
              },
            ].map(({ icon, label, value, colour }) => (
              <div key={label} className="flex flex-col justify-center p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  {icon}
                  <p className="text-xs text-dharma-ink-secondary">{label}</p>
                </div>
                <p className={cn("text-3xl font-bold tabular-nums", colour)}>
                  {value}
                </p>
                <p className="text-xs text-dharma-ink-secondary mt-0.5">
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

      {/* Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Controls</CardTitle>
            <div className="flex items-center gap-2">
              {/* Tree / Flat toggle */}
              <div className="flex rounded-md border border-dharma-border p-0.5" role="group" aria-label="Control view">
                <Button
                  variant={controlView === "tree" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  aria-pressed={controlView === "tree"}
                  onClick={() => setControlView("tree")}
                >
                  <ListTree className="h-3.5 w-3.5" />
                  Tree
                </Button>
                <Button
                  variant={controlView === "flat" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  aria-pressed={controlView === "flat"}
                  onClick={() => setControlView("flat")}
                >
                  <Rows3 className="h-3.5 w-3.5" />
                  Flat
                </Button>
              </div>
              <Badge variant="outline" className="text-xs">
                {framework.controlCount} total
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {controlView === "tree" ? (
            <ControlTree frameworkId={id} />
          ) : (
            <ControlTable
              controls={framework.controls}
              onStatusChanged={handleStatusChanged}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
