"use client";

// Phase 9 Part 1 — endpoint detail: a timeline of posture checks with
// pass/fail badges and links to the mapped control (or an "unmapped" marker).
import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, Link2Off } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Inlined (not imported from the server-side map module) to keep this client
// component's bundle free of any server code. Kept in sync with
// src/server/lib/endpointCheckControlMap.ts CHECK_LABELS.
const CHECK_LABELS: Record<string, string> = {
  disk_encryption: "Disk encryption",
  os_patch_level: "OS patch level",
  screen_lock: "Screen lock",
  firewall_status: "Firewall status",
};

function checkLabel(checkType: string): string {
  return CHECK_LABELS[checkType] ?? checkType;
}

export default function EndpointDetailPage() {
  const params = useParams<{ id: string }>();
  const endpointId = params?.id ?? "";

  const checksQuery = api.endpoint.getChecks.useQuery(
    { endpointId, limit: 100 },
    { enabled: endpointId.length > 0, retry: false },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm">
          <Link href={"/dashboard/endpoints" as never} className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Endpoints
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Posture checks</h1>
        <p className="text-sm text-dharma-ink-secondary">
          Timeline of agent-reported checks, mapped to your controls where possible.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check history</CardTitle>
        </CardHeader>
        <CardContent>
          {checksQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : checksQuery.error ? (
            <p className="py-8 text-center text-sm text-dharma-danger-text">{checksQuery.error.message}</p>
          ) : (checksQuery.data?.items ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-dharma-ink-secondary">
              No checks reported yet — they appear after the agent's first heartbeat.
            </p>
          ) : (
            <ol className="relative space-y-4 border-l pl-4">
              {(checksQuery.data?.items ?? []).map((check) => {
                const pass = (check.result as { pass?: boolean }).pass === true;
                return (
                  <li key={check.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {pass ? (
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="h-3 w-3 text-dharma-success-text" /> Pass
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <XCircle className="h-3 w-3" /> Fail
                        </Badge>
                      )}
                      <span className="text-sm font-medium">{checkLabel(check.checkType)}</span>
                      <span className="text-xs text-dharma-ink-secondary">
                        {new Date(check.collectedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs">
                      {check.control ? (
                        <Link
                          href={`/dashboard/controls/${check.control.id}` as never}
                          className="text-dharma-accent-on-tint hover:underline"
                        >
                          {check.control.domain} — {check.control.title}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-dharma-ink-secondary">
                          <Link2Off className="h-3 w-3" /> Unmapped check (no matching control)
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
