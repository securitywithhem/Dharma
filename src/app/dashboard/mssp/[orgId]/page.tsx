"use client";

// Phase 8 Part 3 — MSSP drill-down into one client org. The persistent
// "Viewing as MSSP" banner is a deliberate UX/security signal (not in the
// docs, flagged as an addition): admins must always know they are looking at
// another tenant's data. Grant re-validation happens server-side on every
// query — nothing here caches access.
import React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"];

export default function MsspDrillDownPage() {
  const params = useParams<{ orgId: string }>();
  const search = useSearchParams();
  const grantId = search?.get("grantId") ?? "";
  const orgId = params?.orgId ?? "";

  const query = api.mssp.drillDown.useQuery(
    { grantId, orgId },
    { enabled: grantId.length > 0 && orgId.length > 0, retry: false },
  );

  return (
    <div className="space-y-6">
      {/* Persistent cross-tenant banner */}
      <div className="flex items-center gap-3 rounded-md border border-dharma-warning bg-dharma-warning-bg px-4 py-2">
        <Eye className="h-4 w-4 text-dharma-ink" />
        <p className="text-sm">
          <span className="font-semibold">Viewing as MSSP</span> — you are inspecting a
          client organization&apos;s data under an audited access grant.
        </p>
        <Button variant="ghost" size="sm" className="ml-auto">
          <Link href={"/dashboard/mssp" as never} className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to overview
          </Link>
        </Button>
      </div>

      {!grantId ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-dharma-ink-secondary">
            Missing grant context — open this page from the client overview.
          </CardContent>
        </Card>
      ) : query.isLoading ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : query.error ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-dharma-danger-text">
            {query.error.message}
          </CardContent>
        </Card>
      ) : query.data ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{query.data.organization.name}</h1>
            <p className="text-sm text-dharma-ink-secondary">
              Client since {new Date(query.data.organization.createdAt).toLocaleDateString()}
              {query.data.lastAudit &&
                ` · last activity ${new Date(query.data.lastAudit.timestamp).toLocaleString()}`}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Frameworks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {query.data.frameworks.length === 0 && (
                  <p className="text-sm text-dharma-ink-secondary">No frameworks yet.</p>
                )}
                {query.data.frameworks.map((framework) => {
                  const pct =
                    framework.totalControls > 0
                      ? Math.round(
                          (framework.compliantControls / framework.totalControls) * 100,
                        )
                      : 0;
                  return (
                    <div key={framework.id} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{framework.name}</span>
                        <span className="text-dharma-ink-secondary">
                          {framework.compliantControls}/{framework.totalControls} ({pct}%)
                        </span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open vulnerabilities</CardTitle>
              </CardHeader>
              <CardContent>
                {query.data.openVulnerabilities.length === 0 ? (
                  <p className="text-sm text-dharma-ink-secondary">No open vulnerabilities.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {[...query.data.openVulnerabilities]
                      .sort(
                        (a, b) =>
                          SEVERITY_ORDER.indexOf(a.severity) -
                          SEVERITY_ORDER.indexOf(b.severity),
                      )
                      .map((vuln) => (
                        <Badge
                          key={vuln.severity}
                          variant={
                            vuln.severity === "CRITICAL" || vuln.severity === "HIGH"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {vuln.severity}: {vuln.count}
                        </Badge>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
