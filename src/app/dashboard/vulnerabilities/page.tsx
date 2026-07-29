"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { LogFindingModal } from "./LogFindingModal";
import { VulnerabilityTrendsChart } from "./VulnerabilityTrendsChart";
import type { Route } from "next";

const SEVERITY_OPTIONS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
const STATUS_OPTIONS = ["ALL", "OPEN", "IN_PROGRESS", "RESOLVED", "WONT_FIX"] as const;

export default function VulnerabilitiesPage() {
  const [showLogFindingModal, setShowLogFindingModal] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<(typeof SEVERITY_OPTIONS)[number]>("ALL");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("ALL");

  const listQuery = api.vulnerability.list.useQuery({
    severity: severityFilter === "ALL" ? undefined : severityFilter,
    status: statusFilter === "ALL" ? undefined : statusFilter,
  });

  const dateRange = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 90);
    return { fromDate, toDate };
  }, []);
  const trendsQuery = api.vulnerability.trends.useQuery(dateRange);

  const vulnerabilities = listQuery.data?.items ?? [];
  const isLoading = listQuery.isLoading;
  const isError = listQuery.isError;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Vulnerabilities</h1>
            {!isLoading && (
              <Badge variant="outline" className="text-xs">
                {vulnerabilities.length} shown
              </Badge>
            )}
          </div>
          <p className="text-dharma-ink-secondary text-sm max-w-xl">
            Findings from automated scans and manually logged issues, tracked through to
            remediation.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link href={"/dashboard/vulnerabilities/triage" as Route}>
            <Button
              variant="outline"
              size="sm"
              aria-label="Open triage board swimlane view"
            >
              Triage Board
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh vulnerabilities"
            onClick={() => void listQuery.refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            id="log-finding-btn"
            aria-label="Log a manual finding"
            onClick={() => setShowLogFindingModal(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Log Finding
          </Button>
        </div>
      </div>

      {trendsQuery.data && <VulnerabilityTrendsChart trends={trendsQuery.data} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-40">
          <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}>
            <SelectTrigger id="severity-filter" aria-label="Filter by severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "ALL" ? "All severities" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger id="status-filter" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "ALL" ? "All statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <Card className="border-dharma-danger bg-dharma-danger-bg">
          <CardHeader>
            <div className="flex items-center gap-2 text-dharma-danger-text">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle className="text-base">Failed to load vulnerabilities</CardTitle>
            </div>
            <CardDescription>
              {listQuery.error?.message ?? "An unexpected error occurred. Please try again."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && vulnerabilities.length === 0 && (
        <div
          role="region"
          aria-label="No vulnerabilities"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-dharma-border py-20 px-6 text-center"
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-dharma-accent-tint">
            <ShieldAlert className="h-7 w-7 text-dharma-accent-on-tint" />
          </div>
          <h2 className="text-lg font-semibold">No findings match these filters</h2>
          <p className="mt-1.5 text-sm text-dharma-ink-secondary max-w-sm">
            Run a pentest or log a finding manually to start tracking vulnerabilities.
          </p>
          <Button className="mt-6" onClick={() => setShowLogFindingModal(true)} id="log-finding-empty-btn">
            <Plus className="h-4 w-4 mr-2" />
            Log Your First Finding
          </Button>
        </div>
      )}

      {!isLoading && !isError && vulnerabilities.length > 0 && (
        <div className="space-y-2" id="vulnerability-list">
          {vulnerabilities.map((v) => (
            <Link
              key={v.id}
              href={(`/dashboard/vulnerabilities/${v.id}`) as Route}
              className="flex items-center justify-between gap-4 rounded-lg border border-dharma-border bg-dharma-surface p-4 transition-colors hover:border-dharma-accent hover:bg-dharma-surface-hover"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{v.title}</p>
                <p className="text-xs text-dharma-ink-secondary truncate">{v.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge severity={v.severity} />
                <Badge variant="outline" className="text-xs">
                  {v.status}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showLogFindingModal && (
        <LogFindingModal
          onClose={() => setShowLogFindingModal(false)}
          onSuccess={() => {
            setShowLogFindingModal(false);
            void listQuery.refetch();
            void trendsQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
