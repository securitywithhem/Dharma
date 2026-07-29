"use client";

/**
 * src/components/ai-advisor/DocumentUploadPanel.tsx
 *
 * Phase 7 Part 3 — upload a document into the Part 1 ingestion pipeline and
 * show live status. Flow: getUploadUrl → PUT to MinIO → uploadDocument → poll
 * getDocumentStatus through the IngestionStatus state machine
 * (PENDING → CHUNKING → EMBEDDING → GRAPH_EXTRACTING → COMPLETED/FAILED), with
 * a sonner toast on completion/failure (mirrors Phase 4's evidence toast).
 */

import { useState } from "react";
import { toast } from "sonner";
import type { IngestionStatus } from "@prisma/client";
import { api } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/** Ordered pipeline stages for progress rendering. */
const STAGES: IngestionStatus[] = ["PENDING", "CHUNKING", "EMBEDDING", "GRAPH_EXTRACTING", "COMPLETED"];

export function ingestionStatusLabel(status: IngestionStatus): string {
  switch (status) {
    case "PENDING": return "Queued…";
    case "CHUNKING": return "Splitting into chunks…";
    case "EMBEDDING": return "Generating embeddings…";
    case "GRAPH_EXTRACTING": return "Extracting knowledge graph…";
    case "COMPLETED": return "Completed";
    case "FAILED": return "Failed";
    default: return status;
  }
}

export function isTerminalStatus(status: IngestionStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

export function ingestionProgressPercent(status: IngestionStatus): number {
  if (status === "FAILED") return 100;
  const idx = STAGES.indexOf(status);
  return idx < 0 ? 0 : Math.round(((idx + 1) / STAGES.length) * 100);
}

export function DocumentUploadPanel({ onIngested }: { onIngested?: (documentId: string) => void }) {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notifiedTerminal, setNotifiedTerminal] = useState(false);

  const getUploadUrl = api.aiIngestion.getUploadUrl.useMutation();
  const uploadDocument = api.aiIngestion.uploadDocument.useMutation();

  const statusQuery = api.aiIngestion.getDocumentStatus.useQuery(
    { documentId: documentId ?? "" },
    {
      enabled: !!documentId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s && isTerminalStatus(s) ? false : 1500;
      },
    },
  );

  const status = statusQuery.data?.status;
  // Toast exactly once when the pipeline reaches a terminal state.
  if (status && isTerminalStatus(status) && !notifiedTerminal) {
    setNotifiedTerminal(true);
    if (status === "COMPLETED") {
      toast.success(`"${statusQuery.data?.filename ?? "Document"}" is ready for the advisor.`);
      if (documentId) onIngested?.(documentId);
    } else {
      toast.error(`Ingestion failed: ${statusQuery.data?.error ?? "unknown error"}`);
    }
  }

  const handleFile = async (file: File) => {
    setUploading(true);
    setNotifiedTerminal(false);
    setDocumentId(null);
    try {
      const { uploadUrl, s3Key } = await getUploadUrl.mutateAsync({ filename: file.name, mimeType: file.type || "application/octet-stream" });
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { documentId: id } = await uploadDocument.mutateAsync({ filename: file.name, mimeType: file.type || "application/octet-stream", s3Key });
      setDocumentId(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-b border-dharma-border p-3">
      <label className="flex cursor-pointer items-center justify-between gap-2">
        <span className="text-sm font-medium">Add a document to context</span>
        <input
          type="file"
          className="sr-only"
          aria-label="Upload a document for the advisor"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" disabled={uploading} type="button" tabIndex={-1}>
          {uploading ? "Uploading…" : "Choose file"}
        </Button>
      </label>

      {documentId && status && (
        <div className="mt-2" role="status" aria-live="polite">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className={status === "FAILED" ? "text-dharma-danger-text" : "text-dharma-ink-secondary"}>{ingestionStatusLabel(status)}</span>
            <span className="text-dharma-ink-secondary">{ingestionProgressPercent(status)}%</span>
          </div>
          <Progress value={ingestionProgressPercent(status)} />
        </div>
      )}
    </div>
  );
}
