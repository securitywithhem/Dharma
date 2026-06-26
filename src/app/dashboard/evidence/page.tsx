"use client";

import { useState } from "react";
import {
  FileText,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceUploadForm } from "./EvidenceUploadForm";
import { EvidenceTable } from "./EvidenceTable";

// ------------------------------------------------------------------
// Page-level stat card
// ------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="py-4 px-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function EvidencePage() {
  const utils = api.useUtils();

  const listQuery = api.evidence.list.useQuery(
    {},
    { staleTime: 30_000 },
  );

  const items = listQuery.data?.items ?? [];

  // Summary stats
  const byType = items.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});

  const expiredCount = items.filter(
    (e) => e.expiresAt && new Date(e.expiresAt) < new Date(),
  ).length;

  async function handleUploadSuccess() {
    await utils.evidence.list.invalidate();
  }

  return (
    <div className="space-y-8">
      {/* ---- Page header ---- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Proof
            </h1>
            {!listQuery.isLoading && (
              <Badge variant="outline" className="text-xs">
                {items.length} file{items.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Upload screenshots, policy documents, API responses, and certificates
            to prove you meet each requirement. Files stay in your secure vault.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh evidence list"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 ${listQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          {/* Global upload — controlId will be empty and the user selects control in the form */}
          <EvidenceUploadForm
            controlId="" /* replaced per-row by the ControlTable */
            onSuccess={handleUploadSuccess}
          />
        </div>
      </div>

      {/* ---- Summary stats ---- */}
      {!listQuery.isLoading && items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Files" value={items.length} />
          <StatCard
            label="Policy Docs"
            value={byType["POLICY_DOC"] ?? 0}
            sub="& Certificates"
          />
          <StatCard
            label="Screenshots"
            value={(byType["SCREENSHOT"] ?? 0) + (byType["API_RESPONSE"] ?? 0)}
            sub="& API responses"
          />
          {expiredCount > 0 ? (
            <StatCard
              label="Expired"
              value={expiredCount}
              sub="Need renewal"
            />
          ) : (
            <Card className="py-4 px-5 border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-xs font-medium">All current</p>
              </div>
              <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                0
              </p>
              <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                expired files
              </p>
            </Card>
          )}
        </div>
      )}

      {/* ---- Evidence table ---- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">All Evidence</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <EvidenceTable showControlColumn />
        </CardContent>
      </Card>
    </div>
  );
}
