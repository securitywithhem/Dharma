"use client";

// Phase 9 Part 2 — reports list + schedule tab (Audit Log Viewer filterable-
// table pattern per 4_UI_UX_DESIGN.md). A COMPLETED report offers a download
// button; GENERATING/QUEUED rows poll report.get every 3s for status.
import React, { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Download, FileText, Presentation, Trash2, Clock } from "lucide-react";
import { api } from "@/lib/trpc";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "default"> = {
  QUEUED: "secondary",
  GENERATING: "secondary",
  COMPLETED: "default",
  FAILED: "destructive",
};

function DownloadButton({ reportId, status }: { reportId: string; status: string }) {
  // Poll while the report is still being produced so the button lights up
  // without a manual refresh.
  const getQuery = api.report.get.useQuery(
    { id: reportId },
    { refetchInterval: status === "QUEUED" || status === "GENERATING" ? 3000 : false },
  );
  const data = getQuery.data;
  if (!data || data.status !== "COMPLETED" || !data.downloadUrl) {
    return <span className="text-xs text-dharma-ink-secondary">{data?.status ?? status}</span>;
  }
  return (
    <Button variant="outline" size="sm" onClick={() => window.open(data.downloadUrl!, "_blank")}>
      <Download className="mr-1 h-3 w-3" /> Download
    </Button>
  );
}

function ReportsTable() {
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const utils = api.useUtils();

  const listQuery = api.report.list.useQuery(
    {
      limit: 50,
      type: type === "all" ? undefined : (type as never),
      status: status === "all" ? undefined : (status as never),
    },
    { refetchInterval: 5000 },
  );
  const del = api.report.delete.useMutation({
    onSuccess: () => {
      toast.success("Report deleted");
      void utils.report.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <span className="text-xs text-dharma-ink-secondary">Type</span>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="CUSTOM_PDF">Custom PDF</SelectItem>
                <SelectItem value="BOARD_SUMMARY">Board summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-dharma-ink-secondary">Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="QUEUED">Queued</SelectItem>
                <SelectItem value="GENERATING">Generating</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {listQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (listQuery.data?.items ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-dharma-ink-secondary">No reports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(listQuery.data?.items ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.title}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs">
                        {r.type === "BOARD_SUMMARY" ? (
                          <Presentation className="h-3 w-3" />
                        ) : (
                          <FileText className="h-3 w-3" />
                        )}
                        {r.type === "BOARD_SUMMARY" ? "Board summary" : "Custom PDF"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                      {r.status === "FAILED" && r.errorMessage && (
                        <span className="ml-2 text-xs text-dharma-ink-secondary">{r.errorMessage}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-dharma-ink-secondary">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <DownloadButton reportId={r.id} status={r.status} />
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={del.isPending}
                          onClick={() => del.mutate({ id: r.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SchedulesTab() {
  const utils = api.useUtils();
  const listQuery = api.report.schedule.list.useQuery();
  const del = api.report.schedule.delete.useMutation({
    onSuccess: () => {
      toast.success("Schedule deleted");
      void utils.report.schedule.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = api.report.schedule.update.useMutation({
    onSuccess: () => void utils.report.schedule.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  if (listQuery.isLoading) return <Skeleton className="h-48 w-full rounded-lg" />;
  const schedules = listQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recurring reports</CardTitle>
      </CardHeader>
      <CardContent>
        {schedules.length === 0 ? (
          <p className="py-6 text-center text-sm text-dharma-ink-secondary">
            No schedules. Create a report and choose a cadence to schedule it.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Recipients</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.map((s) => {
                const recipients = Array.isArray(s.recipients) ? s.recipients : [];
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.title}</TableCell>
                    <TableCell className="text-xs font-mono">{s.cron}</TableCell>
                    <TableCell className="text-xs">{recipients.length}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => update.mutate({ id: s.id, enabled: !s.enabled })}
                      >
                        <Badge variant={s.enabled ? "default" : "secondary"}>
                          {s.enabled ? "On" : "Off"}
                        </Badge>
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => del.mutate({ id: s.id })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<"reports" | "schedules">("reports");
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-dharma-ink-secondary">
            Custom PDF reports and AI-narrated board summaries.
          </p>
        </div>
        <Button>
          <Link href={"/dashboard/reports/new" as never} className="flex items-center">
            <Plus className="mr-2 h-4 w-4" /> New report
          </Link>
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        {(["reports", "schedules"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-dharma-accent text-dharma-accent-on-tint"
                : "border-transparent text-dharma-ink-secondary hover:text-dharma-ink"
            }`}
          >
            {t === "reports" ? "Reports" : (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> Schedules
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "reports" ? <ReportsTable /> : <SchedulesTab />}
    </div>
  );
}
