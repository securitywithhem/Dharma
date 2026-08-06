"use client";

// Phase 8 Part 3 — MSSP Client Overview (App Flow journey 7 steps 1-2):
// grant selector + per-client health tiles (compliance score, open vulns,
// last audit date per UI_UX "MSSP Dashboard"). The "Global map" is
// explicitly skipped per the doc's "not required" note.
import React, { useState } from "react";
import Link from "next/link";
import {
  toast,
} from "sonner";
import { Building2, FileDown, ShieldAlert, Settings2 } from "lucide-react";
import { api } from "@/lib/trpc";
import { QueryError } from "@/components/ui/query-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function scoreTone(score: number | null) {
  if (score === null) return "text-dharma-ink-secondary";
  if (score >= 80) return "text-dharma-success-text";
  if (score >= 50) return "text-dharma-ink";
  return "text-dharma-danger-text";
}

export default function MsspDashboardPage() {
  const [grantId, setGrantId] = useState<string | null>(null);

  const groupsQuery = api.mssp.myGroups.useQuery();
  const activeGrantId = grantId ?? groupsQuery.data?.[0]?.grantId ?? null;

  const overviewQuery = api.mssp.clientOverview.useQuery(
    { grantId: activeGrantId ?? "" },
    { enabled: activeGrantId !== null },
  );
  const report = api.mssp.generateConsolidatedReport.useMutation({
    onSuccess: ({ downloadUrl, clientCount }) => {
      toast.success(`Consolidated report ready (${clientCount} clients)`);
      window.open(downloadUrl, "_blank");
    },
    onError: (error) => toast.error(error.message),
  });

  if (groupsQuery.isLoading) return <Skeleton className="h-96 w-full rounded-lg" />;

  // WAVE 9.2 (§6 HIGH-1) — a failed request previously fell through to the
  // "no client grants" state, which reads as "you have no clients" to an MSSP.
  if (groupsQuery.isError) {
    return (
      <QueryError
        title="Failed to load your client portfolio"
        message={groupsQuery.error?.message}
        onRetry={() => groupsQuery.refetch()}
      />
    );
  }

  const groups = groupsQuery.data ?? [];
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-8 w-8 text-dharma-ink-secondary" />
          <p className="font-medium">No client access grants</p>
          <p className="max-w-md text-sm text-dharma-ink-secondary">
            You need an active MSSP grant to view client organizations. An admin of your
            organization can create one under MSSP → Grants.
          </p>
          <Button variant="outline" size="sm">
            <Link href={"/dashboard/mssp/grants" as never}>Manage grants</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Client overview</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Aggregated compliance across your managed client organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={activeGrantId ?? undefined} onValueChange={setGrantId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select client group" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.grantId} value={g.grantId}>
                  {g.group.name} ({g.scopeOrgCount} clients)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!activeGrantId || report.isPending}
            onClick={() => activeGrantId && report.mutate({ grantId: activeGrantId })}
          >
            <FileDown className="mr-2 h-4 w-4" /> Consolidated report
          </Button>
          <Button variant="ghost" size="icon" title="Manage grants">
            <Link href={"/dashboard/mssp/grants" as never}>
              <Settings2 className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {overviewQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(overviewQuery.data ?? []).map((client) => (
            <Link
              key={client.organizationId}
              href={`/dashboard/mssp/${client.organizationId}?grantId=${activeGrantId}` as never}
            >
              <Card className="transition-colors hover:border-dharma-accent">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-dharma-ink-secondary" />
                    {client.organizationName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${scoreTone(client.complianceScore)}`}>
                      {client.complianceScore === null ? "—" : `${client.complianceScore}%`}
                    </span>
                    <span className="text-xs text-dharma-ink-secondary">
                      {client.compliantControls}/{client.totalControls} controls
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <Badge
                      variant={client.openVulnerabilities > 0 ? "destructive" : "secondary"}
                    >
                      {client.openVulnerabilities} open vulns
                    </Badge>
                    <span className="text-dharma-ink-secondary">
                      Last audit:{" "}
                      {client.lastAuditAt
                        ? new Date(client.lastAuditAt).toLocaleDateString()
                        : "never"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
