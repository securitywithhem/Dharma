"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeverityBadge } from "@/components/pentest/SeverityBadge";
import type { Route } from "next";

// See pentests/[id]/page.tsx for why this is a plain object, not a Promise,
// under this app's Next.js 14 runtime.
interface VulnerabilityDetailPageProps {
  params: { id: string };
}

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "WONT_FIX"] as const;

export default function VulnerabilityDetailPage({ params }: VulnerabilityDetailPageProps) {
  const { id } = params;
  const [controlIdInput, setControlIdInput] = useState("");

  const vulnQuery = api.vulnerability.getById.useQuery({ id }, { enabled: !!id });

  const updateStatusMutation = api.vulnerability.updateStatus.useMutation({
    onSuccess: () => void vulnQuery.refetch(),
    onError: (err) => toast.error(err.message),
  });

  const linkControlMutation = api.vulnerability.linkControl.useMutation({
    onSuccess: () => {
      toast.success("Control linked");
      setControlIdInput("");
      void vulnQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  if (vulnQuery.isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (vulnQuery.isError || !vulnQuery.data) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            <CardTitle className="text-base">Vulnerability not found</CardTitle>
          </div>
        </CardHeader>
      </Card>
    );
  }

  const vuln = vulnQuery.data;

  const handleStatusChange = (status: string) => {
    const isReopeningWontFix = vuln.status === "WONT_FIX" && status !== "WONT_FIX";
    updateStatusMutation.mutate({
      id,
      status: status as (typeof STATUS_OPTIONS)[number],
      force: isReopeningWontFix,
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href={"/dashboard/vulnerabilities" as Route}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
          aria-label="Back to vulnerabilities"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight truncate" title={vuln.title}>
          {vuln.title}
        </h1>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={vuln.severity} />
            <Badge variant="outline">{vuln.status}</Badge>
            {vuln.cvssScore != null && (
              <Badge variant="secondary">CVSS {vuln.cvssScore.toFixed(1)}</Badge>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-muted-foreground mb-1">Description</h2>
            <p className="text-sm">{vuln.description}</p>
          </div>

          {vuln.remediation && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-1">Remediation</h2>
              <p className="text-sm">{vuln.remediation}</p>
            </div>
          )}

          {vuln.cvssVector && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-1">CVSS Vector</h2>
              <p className="text-sm font-mono">{vuln.cvssVector}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="vuln-status-select" className="text-sm font-medium">
                Status
              </label>
              <Select value={vuln.status} onValueChange={handleStatusChange}>
                <SelectTrigger id="vuln-status-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vuln.status === "WONT_FIX" && (
                <p className="text-xs text-muted-foreground">
                  Changing status away from WONT_FIX will reopen this finding.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="vuln-control-id" className="text-sm font-medium">
                Linked control {vuln.controlId ? `(${vuln.controlId})` : "(none)"}
              </label>
              <div className="flex gap-2">
                <Input
                  id="vuln-control-id"
                  placeholder="Control ID"
                  value={controlIdInput}
                  onChange={(e) => setControlIdInput(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!controlIdInput.trim() || linkControlMutation.isPending}
                  onClick={() => linkControlMutation.mutate({ id, controlId: controlIdInput.trim() })}
                >
                  Link
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
