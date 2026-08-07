"use client";

import type { ControlStatus } from "@prisma/client";
import { BookOpen, FileText, Info } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Status configuration
// ------------------------------------------------------------------

const STATUS_OPTIONS: Array<{ value: ControlStatus; label: string; description: string }> = [
  {
    value: "NOT_STARTED",
    label: "Not Started",
    description: "Implementation has not yet begun",
  },
  {
    value: "IN_PROGRESS",
    label: "In Progress",
    description: "Implementation is underway",
  },
  {
    value: "COMPLIANT",
    label: "Compliant",
    description: "Control is fully implemented and evidenced",
  },
  {
    value: "NOT_APPLICABLE",
    label: "Not Applicable",
    description: "Control does not apply to this organization",
  },
];

const STATUS_BADGE: Record<
  ControlStatus,
  { variant: "default" | "secondary" | "outline" | "success" | "warning"; label: string }
> = {
  NOT_STARTED: { variant: "outline", label: "Not Started" },
  IN_PROGRESS: { variant: "warning", label: "In Progress" },
  COMPLIANT: { variant: "success", label: "Compliant" },
  NOT_APPLICABLE: { variant: "secondary", label: "N/A" },
};

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------

interface ControlDetailModalProps {
  controlId: string;
  onClose: () => void;
  onStatusChanged?: () => void;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function ControlDetailModal({
  controlId,
  onClose,
  onStatusChanged,
}: ControlDetailModalProps) {
  const utils = api.useUtils();

  const { data: control, isLoading, isError } = api.control.getById.useQuery(
    { id: controlId },
    { enabled: !!controlId },
  );

  const updateMutation = api.control.updateStatus.useMutation({
    onSuccess: async () => {
      await utils.control.getById.invalidate({ id: controlId });
      await utils.framework.list.invalidate();
      await utils.framework.getById.invalidate();
      onStatusChanged?.();
    },
  });

  const handleStatusChange = (value: string) => {
    updateMutation.mutate({ id: controlId, status: value as ControlStatus });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto"
        aria-labelledby="control-detail-title"
        onClose={onClose}
      >
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {isError && (
          <div role="alert" className="py-8 text-center space-y-2">
            <p className="text-dharma-danger-text font-medium">Failed to load control details.</p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}

        {!isLoading && !isError && control && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3 pr-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-dharma-accent-tint">
                  <BookOpen className="h-4 w-4 text-dharma-accent-on-tint" />
                </div>
                <div className="min-w-0">
                  <DialogTitle id="control-detail-title" className="text-base leading-tight">
                    {control.title}
                  </DialogTitle>
                  <DialogDescription className="mt-0.5">
                    <span className="text-xs font-medium text-dharma-accent-on-tint">
                      {control.framework.name}
                    </span>
                    {" · "}
                    <span className="text-xs">{control.domain}</span>
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-6">
              {/* Status selector */}
              <div className="rounded-lg border border-dharma-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label
                      htmlFor="control-status-select"
                      className="text-sm font-semibold"
                    >
                      Compliance Status
                    </label>
                    <p className="text-xs text-dharma-ink-secondary mt-0.5">
                      Changes are logged in the audit trail
                    </p>
                  </div>
                  <Badge variant={STATUS_BADGE[control.status].variant}>
                    {STATUS_BADGE[control.status].label}
                  </Badge>
                </div>

                <Select
                  value={control.status}
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger
                    id="control-status-select"
                    aria-label="Select control status"
                    className={cn(
                      updateMutation.isPending && "opacity-50 pointer-events-none",
                    )}
                  >
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="ml-1.5 text-xs text-dharma-ink-secondary">
                          — {opt.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* WAVE 11.1 (fullstack-audit-2026-08-06 ARCH-4) — say it where
                    the number is actually being set. Readiness is computed from
                    evidence presence and cross-walk mapping only
                    (src/server/services/readinessScoring.ts); Control.status is
                    never read by it. Leaving both numbers on screen without
                    this note implies one drives the other, and a compliance
                    officer can mark every control COMPLIANT and watch readiness
                    stay at 0%. */}
                <p className="text-xs text-dharma-ink-secondary">
                  Status records your team&rsquo;s assessment. The framework&rsquo;s
                  evidence-coverage score is computed from attached evidence and
                  cross-walk mappings, so changing this does not move it.
                </p>

                {updateMutation.isSuccess && (
                  <p role="status" className="text-xs text-dharma-success-text">
                    ✓ Status updated successfully
                  </p>
                )}
                {updateMutation.isError && (
                  <p role="alert" className="text-xs text-dharma-danger-text">
                    Failed to update status: {updateMutation.error?.message}
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-dharma-ink-secondary" />
                  Description
                </h4>
                <p className="text-sm text-dharma-ink-secondary leading-relaxed">
                  {control.description}
                </p>
              </div>

              {/* Implementation guidance */}
              {control.guidance && (
                <div className="rounded-lg bg-dharma-accent-tint border border-dharma-accent p-4 space-y-2">
                  <h4 className="text-sm font-semibold text-dharma-accent-on-tint">
                    Implementation Guidance
                  </h4>
                  <p className="text-sm text-dharma-ink-secondary leading-relaxed">
                    {control.guidance}
                  </p>
                </div>
              )}

              {/* Linked evidence */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-dharma-ink-secondary" />
                    Linked Evidence
                  </h4>
                  <Badge variant="outline" className="text-xs">
                    {control.evidence.length} file
                    {control.evidence.length !== 1 ? "s" : ""}
                  </Badge>
                </div>

                {control.evidence.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-dharma-border py-6 text-center">
                    <FileText className="h-6 w-6 text-dharma-ink-secondary mx-auto mb-2" />
                    <p className="text-sm text-dharma-ink-secondary">
                      No evidence linked yet
                    </p>
                    <p className="text-xs text-dharma-ink-secondary mt-0.5">
                      Upload evidence from the Evidence section
                    </p>
                  </div>
                ) : (
                  <ul
                    className="space-y-2"
                    aria-label={`Evidence files for ${control.title}`}
                  >
                    {control.evidence.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-dharma-border bg-dharma-surface-hover px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText className="h-4 w-4 text-dharma-ink-secondary shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {ev.fileName}
                            </p>
                            {ev.summary && (
                              <p className="text-xs text-dharma-ink-secondary truncate">
                                {ev.summary}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {ev.type}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Metadata footer */}
              <div className="border-t border-dharma-border pt-4 flex flex-wrap gap-x-6 gap-y-1">
                <p className="text-xs text-dharma-ink-secondary">
                  Created{" "}
                  {new Date(control.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <p className="text-xs text-dharma-ink-secondary">
                  Last updated{" "}
                  {new Date(control.updatedAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
