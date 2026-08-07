"use client";

// Phase 9 Part 3 — regulatory alerts list with a collapsible diff viewer
// (added / removed / modified controls). Alerts arrive when a framework the
// org imported publishes a new version.
import React, { useState } from "react";
import { toast } from "sonner";
import { Bell, Check, X, ChevronDown, ChevronRight, Plus, Minus, Pencil } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/ui/query-error";

type DiffSummary = {
  added?: { key: string; title: string }[];
  removed?: { key: string; title: string }[];
  modified?: { key: string; title: string; changedFields: string[] }[];
};

function DiffSection({
  label,
  icon,
  tone,
  entries,
}: {
  label: string;
  icon: React.ReactNode;
  tone: string;
  entries: { key: string; title: string; changedFields?: string[] }[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>
        {icon} {label} ({entries.length})
      </div>
      <ul className="ml-4 space-y-0.5">
        {entries.map((e) => (
          <li key={e.key} className="text-xs text-dharma-ink-secondary">
            <code className="text-[10px]">{e.key}</code> — {e.title}
            {e.changedFields && e.changedFields.length > 0 && (
              <span className="ml-1 italic">({e.changedFields.join(", ")})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RegulatoryAlertsPage() {
  const utils = api.useUtils();
  const listQuery = api.regulatory.listAlerts.useQuery({ limit: 50 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const invalidate = () => {
    void utils.regulatory.listAlerts.invalidate();
    void utils.regulatory.unreadCount.invalidate();
  };
  const ack = api.regulatory.acknowledgeAlert.useMutation({
    onSuccess: () => { toast.success("Acknowledged"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = api.regulatory.dismissAlert.useMutation({
    onSuccess: () => { toast.success("Dismissed"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (listQuery.isLoading) return <Skeleton className="h-96 w-full rounded-lg" />;

  // WAVE 9.2 (§6 HIGH-1) — without this, a failed request rendered as "no
  // alerts", i.e. "nothing needs your attention", which is the opposite of
  // what an unknown state means for regulatory change monitoring.
  if (listQuery.isError) {
    return (
      <QueryError
        title="Failed to load regulatory alerts"
        message={listQuery.error?.message}
        onRetry={() => listQuery.refetch()}
      />
    );
  }
  const alerts = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-semibold">Regulatory alerts</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Changes to frameworks your organization has imported.
          </p>
        </div>
        {(listQuery.data?.unreadCount ?? 0) > 0 && (
          <Badge className="ml-auto">{listQuery.data?.unreadCount} unread</Badge>
        )}
      </div>

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-dharma-ink-secondary">
            No regulatory alerts. You&apos;ll be notified here when an imported framework updates.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const diff = (alert.diffSummary ?? {}) as DiffSummary;
            const isOpen = expanded[alert.id] ?? false;
            const totalChanges =
              (diff.added?.length ?? 0) + (diff.removed?.length ?? 0) + (diff.modified?.length ?? 0);
            return (
              <Card key={alert.id} className={alert.status === "UNREAD" ? "border-dharma-accent" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {alert.frameworkVersion.marketplaceItem?.name ?? "Framework"}
                        <Badge variant="secondary">v{alert.frameworkVersion.version}</Badge>
                        {alert.status === "UNREAD" && <Badge>New</Badge>}
                        {alert.status === "DISMISSED" && <Badge variant="outline">Dismissed</Badge>}
                      </CardTitle>
                      <p className="mt-1 text-xs text-dharma-ink-secondary">
                        Published {new Date(alert.frameworkVersion.publishedAt).toLocaleString()} ·{" "}
                        {totalChanges} control change{totalChanges === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {alert.status !== "ACKNOWLEDGED" && (
                        <Button variant="ghost" size="icon" title="Acknowledge" onClick={() => ack.mutate({ id: alert.id })}>
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {alert.status !== "DISMISSED" && (
                        <Button variant="ghost" size="icon" title="Dismiss" onClick={() => dismiss.mutate({ id: alert.id })}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {alert.frameworkVersion.changelog && (
                    <p className="mb-2 text-sm">{alert.frameworkVersion.changelog}</p>
                  )}
                  <button
                    className="flex items-center gap-1 text-xs text-dharma-ink-secondary hover:text-dharma-ink"
                    onClick={() => setExpanded({ ...expanded, [alert.id]: !isOpen })}
                  >
                    {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {isOpen ? "Hide" : "Show"} diff
                  </button>
                  {isOpen && (
                    <div className="mt-2 space-y-3 rounded-md border p-3">
                      <DiffSection label="Added" icon={<Plus className="h-3 w-3" />} tone="text-dharma-success-text" entries={diff.added ?? []} />
                      <DiffSection label="Removed" icon={<Minus className="h-3 w-3" />} tone="text-dharma-danger-text" entries={diff.removed ?? []} />
                      <DiffSection label="Modified" icon={<Pencil className="h-3 w-3" />} tone="text-dharma-ink" entries={diff.modified ?? []} />
                      {totalChanges === 0 && (
                        <p className="text-xs text-dharma-ink-secondary">No control-level changes recorded.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
