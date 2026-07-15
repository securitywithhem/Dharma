"use client";

// Phase 8 Part 2 — enterprise audit log viewer (UI_UX doc: "Filterable table
// of events, date range picker, export CSV"). The flat table is the primary
// view; "Related events" (correlation-graph chain) opens per-row as a
// secondary panel — rendered as a lightweight timeline list rather than
// adding a graph-viz dependency (reactflow is not in this repo).
import React, { useState } from "react";
import { toast } from "sonner";
import { Download, GitBranch, X, Link2 } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VIA_LABELS: Record<string, string> = {
  graph: "Linked via graph",
  "same-actor-session": "Same actor (session window)",
  "same-resource": "Same resource",
};

export default function EnterpriseAuditLogPage() {
  const [filters, setFilters] = useState<{
    action?: string;
    from?: string;
    to?: string;
  }>({});
  const [chainAnchorId, setChainAnchorId] = useState<string | null>(null);

  const queryInput = {
    limit: 100,
    action: filters.action || undefined,
    from: filters.from ? new Date(filters.from) : undefined,
    to: filters.to ? new Date(`${filters.to}T23:59:59`) : undefined,
  };

  const listQuery = api.audit.list.useQuery(queryInput);
  const actionsQuery = api.audit.listActions.useQuery();
  const chainQuery = api.audit.getEventChain.useQuery(
    { auditLogId: chainAnchorId ?? "", hops: 2 },
    { enabled: chainAnchorId !== null },
  );

  const exportCsv = api.audit.exportCsv.useMutation({
    onSuccess: ({ downloadUrl, rowCount }) => {
      toast.success(`Export ready (${rowCount} rows) — download starting`);
      window.open(downloadUrl, "_blank");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Append-only, hash-chained record of every action in this organization.
          </p>
        </div>
        <Button
          onClick={() =>
            exportCsv.mutate({
              action: queryInput.action,
              from: queryInput.from,
              to: queryInput.to,
            })
          }
          disabled={exportCsv.isPending}
        >
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label>Action</Label>
            <Select
              value={filters.action ?? "all"}
              onValueChange={(value) =>
                setFilters({ ...filters, action: value === "all" ? undefined : value })
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {(actionsQuery.data ?? []).map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            />
          </div>
        </CardContent>
      </Card>

      <div className={`grid gap-4 ${chainAnchorId ? "lg:grid-cols-3" : ""}`}>
        <Card className={chainAnchorId ? "lg:col-span-2" : ""}>
          <CardHeader>
            <CardTitle className="text-base">Events</CardTitle>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(listQuery.data?.items ?? []).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.user?.email ?? log.userId ?? "system"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.entity}:{log.entityId.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setChainAnchorId(log.id)}
                          title="Show related events"
                        >
                          <GitBranch className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {chainAnchorId && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" /> Related events
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setChainAnchorId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {chainQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (chainQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No correlated events found for this entry.
                </p>
              ) : (
                <ol className="relative space-y-4 border-l pl-4">
                  {(chainQuery.data ?? []).map((related) => (
                    <li key={related.auditLog.id} className="space-y-1">
                      <div className="text-xs text-muted-foreground">
                        {new Date(related.auditLog.timestamp).toLocaleString()}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {related.auditLog.action}
                        </Badge>
                        <span className="text-xs">
                          {related.auditLog.user?.email ?? "system"}
                        </span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {VIA_LABELS[related.via] ?? related.via}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
