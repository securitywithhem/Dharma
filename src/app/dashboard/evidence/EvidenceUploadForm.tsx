"use client";

import { useCallback, useRef, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import type { EvidenceType } from "@prisma/client";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  File,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const EVIDENCE_TYPES: Array<{ value: EvidenceType; label: string; description: string }> = [
  { value: "SCREENSHOT", label: "Screenshot", description: "UI screenshots, dashboard exports" },
  { value: "POLICY_DOC", label: "Policy Document", description: "Written policies, procedures" },
  { value: "API_RESPONSE", label: "API Response", description: "JSON/XML API logs" },
  { value: "LOG_EXCERPT", label: "Log Excerpt", description: "System, audit, or event logs" },
  { value: "CERTIFICATE", label: "Certificate", description: "SSL/TLS, ISO, security certs" },
  { value: "OTHER", label: "Other", description: "Any other compliance artefact" },
];

type UploadState =
  | { phase: "idle" }
  | { phase: "selected"; file: File }
  | { phase: "uploading"; file: File; progress: number }
  | { phase: "success"; file: File }
  | { phase: "error"; file?: File; message: string };

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------

interface EvidenceUploadFormProps {
  /** Compliance control this evidence will be linked to */
  controlId: string;
  /** Called after a successful upload so the parent can refresh */
  onSuccess?: () => void;
  /** Optionally render just the trigger button with a custom label */
  triggerLabel?: string;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function EvidenceUploadForm({
  controlId,
  onSuccess,
  triggerLabel = "Add Proof",
}: EvidenceUploadFormProps) {
  const [open, setOpen] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("SCREENSHOT");

  // Keep an AbortController ref so we can cancel in-flight XHR
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const utils = api.useUtils();
  const getUploadUrlMutation = api.evidence.getUploadUrl.useMutation();
  const createEvidenceMutation = api.evidence.create.useMutation();

  // ------------------------------------------------------------------
  // Dropzone
  // ------------------------------------------------------------------

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadState({ phase: "selected", file });
    }
  }, []);

  const onDropRejected = useCallback(
    (rejectedFiles: FileRejection[]) => {
      const reason = rejectedFiles[0]?.errors[0]?.message ?? "File rejected";
      setUploadState({ phase: "error", message: reason });
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      onDropRejected,
      maxFiles: 1,
      maxSize: MAX_FILE_SIZE,
      multiple: false,
    });

  // ------------------------------------------------------------------
  // Upload logic
  // ------------------------------------------------------------------

  async function handleUpload() {
    const file =
      uploadState.phase === "selected" || uploadState.phase === "error"
        ? (uploadState as { file: File }).file
        : null;

    if (!file) return;

    try {
      setUploadState({ phase: "uploading", file, progress: 0 });

      // Step 1: get presigned URL from tRPC
      const { uploadUrl, filePath } = await getUploadUrlMutation.mutateAsync({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        controlId,
      });

      // Step 2: PUT directly to MinIO with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setUploadState({
              phase: "uploading",
              file,
              progress: Math.round((e.loaded / e.total) * 100),
            });
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`MinIO responded with HTTP ${xhr.status}`));
          }
        });
        xhr.addEventListener("error", () =>
          reject(new Error("Network error during upload")),
        );
        xhr.addEventListener("abort", () =>
          reject(new Error("Upload cancelled")),
        );

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        xhr.send(file);
      });

      // Step 3: create DB record via tRPC
      await createEvidenceMutation.mutateAsync({
        controlId,
        fileName: file.name,
        filePath,
        type: evidenceType,
      });

      // Step 4: invalidate evidence list cache
      await utils.evidence.list.invalidate();

      setUploadState({ phase: "success", file });
      setTimeout(() => {
        resetForm();
        onSuccess?.();
      }, 1800);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadState({
        phase: "error",
        file:
          uploadState.phase === "uploading" ? uploadState.file : undefined,
        message: msg,
      });
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function resetForm() {
    setOpen(false);
    setUploadState({ phase: "idle" });
    setEvidenceType("SCREENSHOT");
    xhrRef.current = null;
  }

  function cancelUpload() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setUploadState({ phase: "idle" });
  }

  const currentFile =
    uploadState.phase !== "idle"
      ? (uploadState as { file?: File }).file
      : null;

  const isUploading = uploadState.phase === "uploading";
  const uploadProgress =
    uploadState.phase === "uploading" ? uploadState.progress : 0;
  const canUpload =
    (uploadState.phase === "selected" || uploadState.phase === "error") &&
    !!(uploadState as { file?: File }).file;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <>
      <Button
        id="evidence-upload-trigger"
        onClick={() => setOpen(true)}
        size="sm"
      >
        <Upload className="h-4 w-4 mr-1.5" />
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isUploading && (o ? setOpen(true) : resetForm())}>
        <DialogContent
          className="max-w-lg"
          aria-labelledby="evidence-upload-title"
          onClose={resetForm}
        >
          <DialogHeader>
            <DialogTitle id="evidence-upload-title">
                  Add Proof
            </DialogTitle>
            <DialogDescription>
              Attach a file as proof for this requirement. Supported: PDF, images,
              JSON, CSV, ZIP — max&nbsp;50 MB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* ---- Dropzone ---- */}
            <div
              {...getRootProps()}
              role="button"
              tabIndex={0}
              aria-label="Drop zone: click or drag a file here"
              className={`
                relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
                p-8 text-center transition-colors cursor-pointer select-none
                ${isDragReject ? "border-destructive bg-destructive/5" : ""}
                ${isDragActive && !isDragReject ? "border-primary bg-primary/5" : ""}
                ${!isDragActive && !isDragReject ? "border-border hover:border-primary/50 hover:bg-muted/30" : ""}
                ${isUploading ? "pointer-events-none opacity-60" : ""}
              `}
            >
              <input {...getInputProps()} aria-hidden="true" />

              {currentFile ? (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <File className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-medium text-sm truncate max-w-xs">
                      {currentFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(currentFile.size / 1024).toFixed(1)} KB ·{" "}
                      {currentFile.type || "unknown type"}
                    </p>
                  </div>
                  {!isUploading && (
                    <button
                      type="button"
                      aria-label="Remove selected file"
                      className="absolute right-3 top-3 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadState({ phase: "idle" });
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                    <Cloud className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">
                      {isDragActive
                        ? "Drop it here!"
                        : "Drag & drop or click to browse"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Max 50 MB
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* ---- Evidence type ---- */}
            <div className="space-y-1.5">
              <label
                htmlFor="evidence-type-select"
                className="text-sm font-medium"
              >
                Evidence Type
              </label>
              <Select
                value={evidenceType}
                onValueChange={(v) => setEvidenceType(v as EvidenceType)}
              >
                <SelectTrigger
                  id="evidence-type-select"
                  aria-label="Select evidence type"
                  className={isUploading ? "pointer-events-none opacity-60" : ""}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map((et) => (
                    <SelectItem key={et.value} value={et.value}>
                      <span className="font-medium">{et.label}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        — {et.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ---- Upload progress ---- */}
            {isUploading && (
              <div className="space-y-2" role="status" aria-live="polite">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </span>
                  <span className="tabular-nums font-medium">
                    {uploadProgress}%
                  </span>
                </div>
                <Progress
                  value={uploadProgress}
                  className="h-2"
                  aria-label={`Upload progress: ${uploadProgress}%`}
                />
              </div>
            )}

            {/* ---- Success banner ---- */}
            {uploadState.phase === "success" && (
              <div
                role="status"
                className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950"
              >
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  Evidence uploaded and linked successfully.
                </p>
              </div>
            )}

            {/* ---- Error banner ---- */}
            {uploadState.phase === "error" && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
              >
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Upload failed
                  </p>
                  <p className="text-xs text-destructive/80 mt-0.5">
                    {uploadState.message}
                  </p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={isUploading ? cancelUpload : resetForm}
              disabled={uploadState.phase === "success"}
            >
              {isUploading ? "Cancel Upload" : "Cancel"}
            </Button>
            <Button
              id="evidence-upload-submit"
              onClick={handleUpload}
              disabled={!canUpload || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-1.5" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
