"use client";

import { useState } from "react";
import type { EvidenceType } from "@prisma/client";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Search,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const TYPE_CONFIG: Record<
  EvidenceType,
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "warning" }
> = {
  SCREENSHOT: { label: "Screenshot", variant: "outline" },
  POLICY_DOC: { label: "Policy Doc", variant: "default" },
  API_RESPONSE: { label: "API Response", variant: "secondary" },
  LOG_EXCERPT: { label: "Log Excerpt", variant: "secondary" },
  CERTIFICATE: { label: "Certificate", variant: "success" },
  OTHER: { label: "Other", variant: "outline" },
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------

interface EvidenceTableProps {
  /** Filter evidence to a specific control */
  controlId?: string;
  /** Show control name column (when listing all evidence across the org) */
  showControlColumn?: boolean;
}

// ------------------------------------------------------------------
// Delete Confirmation Modal
// ------------------------------------------------------------------

function DeleteConfirmDialog({
  fileName,
  onConfirm,
  onCancel,
  isPending,
}: {
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent
        className="max-w-sm"
        aria-labelledby="delete-evidence-title"
        onClose={onCancel}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle id="delete-evidence-title">
                Delete Evidence
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                This action cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to permanently delete{" "}
          <span className="font-semibold text-foreground">{fileName}</span>? The
          file will be removed from storage and the audit log will record this
          deletion.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// Main Component
// ------------------------------------------------------------------

export function EvidenceTable({
  controlId,
  showControlColumn = true,
}: EvidenceTableProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const utils = api.useUtils();

  const listQuery = api.evidence.list.useQuery(
    {
      controlId,
      type: (typeFilter as EvidenceType) || undefined,
    },
    { staleTime: 30_000 },
  );

  const deleteMutation = api.evidence.delete.useMutation({
    onSuccess: async () => {
      await utils.evidence.list.invalidate();
      setDeleteTargetId(null);
    },
  });

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const data = await utils.evidence.getById.fetch({ id });
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDownloadingId(null);
    }
  };

  // ------------------------------------------------------------------
  // Derived data
  // ------------------------------------------------------------------

  const allItems = listQuery.data?.items ?? [];
  const filteredItems = allItems.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.fileName.toLowerCase().includes(q) ||
      e.control.title.toLowerCase().includes(q) ||
      e.control.domain.toLowerCase().includes(q)
    );
  });

  const deleteTarget = allItems.find((e) => e.id === deleteTargetId);

  // ------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------

  if (listQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Error
  // ------------------------------------------------------------------

  if (listQuery.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <CardTitle className="text-base">Failed to load evidence</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ------------------------------------------------------------------
  // Empty
  // ------------------------------------------------------------------

  if (allItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <ShieldOff className="h-8 w-8 text-muted-foreground mb-3" />
        <h3 className="font-semibold text-sm">No evidence uploaded yet</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Upload files using the button above to link them to controls.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Table
  // ------------------------------------------------------------------

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search evidence…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 w-full sm:w-64"
            aria-label="Search evidence"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All types</SelectItem>
            {Object.entries(TYPE_CONFIG).map(([value, cfg]) => (
              <SelectItem key={value} value={value}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {search && (
        <p className="text-xs text-muted-foreground mb-3">
          Showing {filteredItems.length} of {allItems.length} files
        </p>
      )}

      {filteredItems.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground rounded-lg border border-dashed border-border">
          No evidence matches your search.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              {showControlColumn && (
                <TableHead className="w-[200px]">Control</TableHead>
              )}
              <TableHead className="w-[110px]">Uploaded</TableHead>
              <TableHead className="w-[100px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((evidence) => {
              const typeConfig = TYPE_CONFIG[evidence.type];
              const isExpired =
                evidence.expiresAt && new Date(evidence.expiresAt) < new Date();

              return (
                <TableRow
                  key={evidence.id}
                  className={cn(isExpired && "opacity-50")}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p
                          className="text-sm font-medium truncate max-w-[240px]"
                          title={evidence.fileName}
                        >
                          {evidence.fileName}
                        </p>
                        {evidence.summary && (
                          <p className="text-xs text-muted-foreground truncate max-w-[240px]">
                            {evidence.summary}
                          </p>
                        )}
                        {isExpired && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] h-4 px-1.5 mt-0.5"
                          >
                            Expired
                          </Badge>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant={typeConfig.variant} className="text-xs">
                      {typeConfig.label}
                    </Badge>
                  </TableCell>

                  {showControlColumn && (
                    <TableCell>
                      <div className="min-w-0">
                        <p
                          className="text-xs font-medium truncate"
                          title={evidence.control.title}
                        >
                          {evidence.control.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {evidence.control.domain}
                        </p>
                      </div>
                    </TableCell>
                  )}

                  <TableCell>
                    <time
                      dateTime={new Date(evidence.createdAt).toISOString()}
                      className="text-xs text-muted-foreground"
                    >
                      {new Date(evidence.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        aria-label={`Download ${evidence.fileName}`}
                        onClick={() => handleDownload(evidence.id)}
                        disabled={downloadingId === evidence.id}
                      >
                        {downloadingId === evidence.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        aria-label={`Delete ${evidence.fileName}`}
                        onClick={() => setDeleteTargetId(evidence.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Load more */}
      {listQuery.data?.hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
          >
            Load more
          </Button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTargetId && deleteTarget && (
        <DeleteConfirmDialog
          fileName={deleteTarget.fileName}
          isPending={deleteMutation.isPending}
          onConfirm={() =>
            deleteMutation.mutate({ id: deleteTargetId })
          }
          onCancel={() => setDeleteTargetId(null)}
        />
      )}
    </>
  );
}
