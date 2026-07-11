"use client";

import { useMemo, useState } from "react";
import { api } from "@/hooks/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SeverityBadge } from "@/components/pentest/SeverityBadge";

interface LogFindingModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// CVSS v3.1 base metric options — https://www.first.org/cvss/v3.1/specification-document
const METRICS: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }> = [
  { key: "AV", label: "Attack Vector", options: [{ value: "N", label: "Network" }, { value: "A", label: "Adjacent" }, { value: "L", label: "Local" }, { value: "P", label: "Physical" }] },
  { key: "AC", label: "Attack Complexity", options: [{ value: "L", label: "Low" }, { value: "H", label: "High" }] },
  { key: "PR", label: "Privileges Required", options: [{ value: "N", label: "None" }, { value: "L", label: "Low" }, { value: "H", label: "High" }] },
  { key: "UI", label: "User Interaction", options: [{ value: "N", label: "None" }, { value: "R", label: "Required" }] },
  { key: "S", label: "Scope", options: [{ value: "U", label: "Unchanged" }, { value: "C", label: "Changed" }] },
  { key: "C", label: "Confidentiality", options: [{ value: "N", label: "None" }, { value: "L", label: "Low" }, { value: "H", label: "High" }] },
  { key: "I", label: "Integrity", options: [{ value: "N", label: "None" }, { value: "L", label: "Low" }, { value: "H", label: "High" }] },
  { key: "A", label: "Availability", options: [{ value: "N", label: "None" }, { value: "L", label: "Low" }, { value: "H", label: "High" }] },
];

export function LogFindingModal({ onClose, onSuccess }: LogFindingModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [remediation, setRemediation] = useState("");
  const [useCvssBuilder, setUseCvssBuilder] = useState(true);
  const [manualSeverity, setManualSeverity] = useState<"NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [metricValues, setMetricValues] = useState<Record<string, string>>({});

  const vector = useMemo(() => {
    if (METRICS.some((m) => !metricValues[m.key])) return null;
    const parts = METRICS.map((m) => `${m.key}:${metricValues[m.key]}`).join("/");
    return `CVSS:3.1/${parts}`;
  }, [metricValues]);

  const previewQuery = api.vulnerability.previewCvssScore.useQuery(
    { vector: vector ?? "" },
    { enabled: useCvssBuilder && !!vector },
  );

  const createMutation = api.vulnerability.createManual.useMutation({ onSuccess });

  const isValid =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    (useCvssBuilder ? !!vector && previewQuery.data?.valid : true);

  const handleSubmit = () => {
    if (!isValid) return;
    createMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      remediation: remediation.trim() || undefined,
      ...(useCvssBuilder && vector ? { cvssVector: vector } : { severity: manualSeverity }),
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-xl" aria-labelledby="log-finding-title" onClose={onClose}>
        <DialogHeader>
          <DialogTitle id="log-finding-title">Log a Finding</DialogTitle>
          <DialogDescription>
            Manually record a vulnerability, with an optional CVSS v3.1 severity score.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="finding-title" className="text-sm font-medium">
              Title <span aria-hidden="true">*</span>
            </label>
            <Input id="finding-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="finding-description" className="text-sm font-medium">
              Description <span aria-hidden="true">*</span>
            </label>
            <Textarea
              id="finding-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="finding-remediation" className="text-sm font-medium">
              Remediation (optional)
            </label>
            <Textarea
              id="finding-remediation"
              value={remediation}
              onChange={(e) => setRemediation(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex gap-2 rounded-lg border border-border p-1">
            {[
              { key: true, label: "CVSS Builder" },
              { key: false, label: "Manual Severity" },
            ].map((opt) => (
              <button
                key={String(opt.key)}
                type="button"
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  useCvssBuilder === opt.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setUseCvssBuilder(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {useCvssBuilder ? (
            <div className="space-y-3" id="cvss-builder">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {METRICS.map((metric) => (
                  <div key={metric.key} className="space-y-1">
                    <label htmlFor={`cvss-${metric.key}`} className="text-xs font-medium text-muted-foreground">
                      {metric.label}
                    </label>
                    <Select
                      value={metricValues[metric.key] ?? ""}
                      onValueChange={(v) => setMetricValues((prev) => ({ ...prev, [metric.key]: v }))}
                    >
                      <SelectTrigger id={`cvss-${metric.key}`} className="text-xs">
                        <SelectValue placeholder={metric.key} />
                      </SelectTrigger>
                      <SelectContent>
                        {metric.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div
                id="cvss-preview"
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
              >
                {!vector ? (
                  <p className="text-xs text-muted-foreground">Select all 8 metrics to see the score.</p>
                ) : previewQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Calculating…</p>
                ) : previewQuery.data?.valid ? (
                  <>
                    <span className="text-sm font-mono text-muted-foreground">{vector}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold tabular-nums">{previewQuery.data.score.toFixed(1)}</span>
                      <SeverityBadge severity={previewQuery.data.severity} />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-destructive">{previewQuery.data?.error ?? "Invalid vector"}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="finding-manual-severity" className="text-sm font-medium">
                Severity
              </label>
              <Select value={manualSeverity} onValueChange={(v) => setManualSeverity(v as typeof manualSeverity)}>
                <SelectTrigger id="finding-manual-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {createMutation.error && (
          <p role="alert" className="text-xs text-destructive mt-2">
            {createMutation.error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            id="log-finding-submit"
            onClick={handleSubmit}
            disabled={!isValid || createMutation.isPending}
          >
            {createMutation.isPending ? "Logging…" : "Log Finding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
