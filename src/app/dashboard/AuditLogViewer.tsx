"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Action colour map
// ------------------------------------------------------------------

const ACTION_CONFIG: Record<
  string,
  { colour: string; badgeVariant: "default" | "secondary" | "outline" | "success" | "warning" | "destructive" }
> = {
  EVIDENCE_UPLOADED: { colour: "text-emerald-600 dark:text-emerald-400", badgeVariant: "success" },
  EVIDENCE_DELETED: { colour: "text-rose-500 dark:text-rose-400", badgeVariant: "secondary" },
  CONTROL_STATUS_UPDATED: { colour: "text-amber-600 dark:text-amber-400", badgeVariant: "warning" },
  EVIDENCE_CREATED: { colour: "text-emerald-600 dark:text-emerald-400", badgeVariant: "success" },
  FRAMEWORK_CREATED: { colour: "text-primary", badgeVariant: "default" },
  CONTROL_UPDATED: { colour: "text-amber-600 dark:text-amber-400", badgeVariant: "warning" },
};

function getActionConfig(action: string) {
  return (
    ACTION_CONFIG[action] ?? {
      colour: "text-muted-foreground",
      badgeVariant: "outline" as const,
    }
  );
}

// ------------------------------------------------------------------
// Single log row (expandable)
// ------------------------------------------------------------------

interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  changes: unknown;
  timestamp: Date;
  previousHash: string | null;
  currentHash: string;
  user: { id: string; name: string | null; email: string | null } | null;
}

function AuditLogRow({
  log,
  isHighlighted,
}: {
  log: AuditLogEntry;
  isHighlighted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = getActionConfig(log.action);

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors",
        isHighlighted
          ? "border-destructive/60 bg-destructive/5"
          : "border-border/70 bg-card hover:bg-muted/20",
      )}
    >
      {/* Summary row */}
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="mt-0.5 shrink-0">
          {isHighlighted ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <Shield className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={config.badgeVariant}
              className="text-xs font-mono"
            >
              {log.action}
            </Badge>
            <span className="text-xs text-muted-foreground">
              on <span className="font-medium text-foreground">{log.entity}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5">
            {log.user && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {log.user.name ?? log.user.email ?? log.user.id}
              </span>
            )}
            <time
              dateTime={new Date(log.timestamp).toISOString()}
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              <Clock className="h-3 w-3" />
              {new Date(log.timestamp).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>

          {/* Hash snippet */}
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/60 truncate">
            <span className="text-muted-foreground/40">SHA-256:</span>{" "}
            {log.currentHash.slice(0, 24)}…
          </p>
        </div>

        <div className="shrink-0 mt-0.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/50 px-4 py-4 space-y-4">
          {/* Hash chain */}
          <div className="rounded-md bg-muted/40 p-3 space-y-2 font-mono text-xs">
            <div className="flex gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-muted-foreground uppercase tracking-widest text-[9px]">
                  Current hash
                </p>
                <p className="break-all text-foreground/80">{log.currentHash}</p>
              </div>
            </div>
            {log.previousHash && (
              <div className="flex gap-2">
                <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-muted-foreground uppercase tracking-widest text-[9px]">
                    Previous hash
                  </p>
                  <p className="break-all text-foreground/60">
                    {log.previousHash}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Changes */}
          {log.changes != null && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                Changes
              </p>
              <pre className="rounded-md bg-muted/40 px-3 py-2 text-xs overflow-x-auto text-foreground/70">
                {JSON.stringify(log.changes as Record<string, unknown>, null, 2)}
              </pre>
            </div>
          )}

          {/* Entity ID */}
          <p className="text-xs text-muted-foreground">
            Entity ID:{" "}
            <span className="font-mono text-foreground/60">{log.entityId}</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Main component
// ------------------------------------------------------------------

export function AuditLogViewer() {
  const [actionFilter, setActionFilter] = useState("");
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    brokenAtId: string | null;
    reason: string | null;
    checkedAt: Date;
    totalChecked: number;
  } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const utils = api.useUtils();

  const logsQuery = api.audit.list.useQuery(
    { action: actionFilter || undefined },
    { staleTime: 60_000 },
  );

  const actionsQuery = api.audit.listActions.useQuery(undefined, {
    staleTime: 300_000,
  });

  const integrityQuery = api.audit.verifyIntegrity.useQuery(undefined, {
    enabled: false, // only fetch on demand
  });

  async function handleVerify() {
    setIsVerifying(true);
    try {
      const result = await utils.audit.verifyIntegrity.fetch();
      setVerifyResult(result as typeof verifyResult);
    } finally {
      setIsVerifying(false);
    }
  }

  const logs = logsQuery.data?.items ?? [];
  const highlightedId = verifyResult?.ok === false ? verifyResult.brokenAtId : null;

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Integrity banner                                                     */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                SHA-256 Hash Chain Integrity
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerify}
              disabled={isVerifying}
              id="verify-audit-chain-btn"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Verify Chain
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        {verifyResult && (
          <CardContent>
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4",
                verifyResult.ok
                  ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
                  : "border-destructive/30 bg-destructive/5",
              )}
            >
              {verifyResult.ok ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    verifyResult.ok
                      ? "text-emerald-800 dark:text-emerald-300"
                      : "text-destructive",
                  )}
                >
                  {verifyResult.ok
                    ? "Audit chain is intact — no tampering detected"
                    : `Chain integrity violation detected`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Checked {verifyResult.totalChecked} entries ·{" "}
                  {new Date(verifyResult.checkedAt).toLocaleString("en-IN")}
                </p>
                {!verifyResult.ok && verifyResult.brokenAtId && (
                  <p className="text-xs text-destructive">
                    First broken entry ID:{" "}
                    <span className="font-mono">
                      {verifyResult.brokenAtId}
                    </span>
                    {verifyResult.reason && ` — ${verifyResult.reason}`}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Log list                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">
            Activity Log{" "}
            {!logsQuery.isLoading && (
              <span className="text-muted-foreground font-normal text-sm">
                ({logs.length})
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="">All actions</option>
              {actionsQuery.data?.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Refresh logs"
              onClick={() => void logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  logsQuery.isFetching && "animate-spin",
                )}
              />
            </Button>
          </div>
        </div>

        {/* Loading */}
        {logsQuery.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Empty */}
        {!logsQuery.isLoading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Shield className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No audit logs yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Compliance actions will appear here.
            </p>
          </div>
        )}

        {/* Log entries */}
        {!logsQuery.isLoading && logs.length > 0 && (
          <div className="space-y-2">
            {logs.map((log) => (
              <AuditLogRow
                key={log.id}
                log={log as AuditLogEntry}
                isHighlighted={log.id === highlightedId}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {logsQuery.data?.hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void logsQuery.refetch()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
