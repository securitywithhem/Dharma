"use client";

import { useMemo, useState } from "react";
import type { MappingStrength } from "@prisma/client";
import { Sparkles, X } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { TreeControl } from "@/components/controls/treeUtils";
import { MappableControlTree } from "./MappableControlTree";
import { strengthForConfidence } from "@/lib/mappingStrength";

interface CrossWalkPickerProps {
  frameworkAId: string;
  frameworkBId: string;
  frameworkAName: string;
  frameworkBName: string;
}

interface SelectedSide {
  control: TreeControl;
  side: "A" | "B";
}

interface PendingMapping {
  source: SelectedSide;
  target: SelectedSide;
  suggestedByAI: boolean;
  confidenceScore?: number;
  defaultStrength: MappingStrength;
}

export function CrossWalkPicker({ frameworkAId, frameworkBId, frameworkAName, frameworkBName }: CrossWalkPickerProps) {
  const utils = api.useUtils();
  const treeA = api.control.getTree.useQuery({ frameworkId: frameworkAId });
  const treeB = api.control.getTree.useQuery({ frameworkId: frameworkBId });
  const pair = api.controlMapping.listForFrameworkPair.useQuery({ frameworkAId, frameworkBId });

  const [selected, setSelected] = useState<SelectedSide | null>(null);
  const [pending, setPending] = useState<PendingMapping | null>(null);

  const mappedIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of pair.data?.mappings ?? []) {
      set.add(m.sourceControlId);
      set.add(m.targetControlId);
    }
    return set;
  }, [pair.data]);

  const suggestions = api.controlMapping.getSuggestions.useQuery(
    {
      controlId: selected?.control.id ?? "",
      targetFrameworkId: selected?.side === "A" ? frameworkBId : frameworkAId,
    },
    { enabled: !!selected },
  );

  const createMutation = api.controlMapping.create.useMutation({
    onSuccess: async () => {
      setPending(null);
      setSelected(null);
      await Promise.all([
        utils.controlMapping.listForFrameworkPair.invalidate({ frameworkAId, frameworkBId }),
        utils.controlMapping.getOverlapMatrix.invalidate({ frameworkAId, frameworkBId }),
      ]);
    },
  });

  const handlePick = (side: "A" | "B", control: TreeControl) => {
    if (!selected) {
      setSelected({ control, side });
      return;
    }
    if (selected.side === side) {
      // Re-picking on the same side replaces the pending source.
      setSelected({ control, side });
      return;
    }
    // Opposite side clicked — complete the pair and open the confirm dialog.
    setPending({
      source: selected,
      target: { control, side },
      suggestedByAI: false,
      defaultStrength: "PARTIAL",
    });
    setSelected(null);
  };

  const acceptSuggestion = (suggestion: { controlId: string; title: string; code: string | null; domain: string; confidenceScore: number }) => {
    if (!selected) return;
    const targetSide: "A" | "B" = selected.side === "A" ? "B" : "A";
    const targetControl: TreeControl = {
      id: suggestion.controlId,
      frameworkId: targetSide === "A" ? frameworkAId : frameworkBId,
      parentId: null,
      code: suggestion.code ?? undefined,
      domain: suggestion.domain,
      title: suggestion.title,
      description: "",
      status: "NOT_STARTED",
      depth: 0,
      sortOrder: 0,
      evidenceCount: 0,
      children: [],
    };
    setPending({
      source: selected,
      target: { control: targetControl, side: targetSide },
      suggestedByAI: true,
      confidenceScore: suggestion.confidenceScore,
      defaultStrength: strengthForConfidence(suggestion.confidenceScore),
    });
    setSelected(null);
  };

  if (treeA.isLoading || treeB.isLoading || pair.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{frameworkAName}</CardTitle>
          </CardHeader>
          <CardContent>
            <MappableControlTree
              roots={(treeA.data?.roots ?? []) as unknown as TreeControl[]}
              mappedIds={mappedIds}
              selectedId={selected?.side === "A" ? selected.control.id : null}
              onSelect={(c) => handlePick("A", c)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{frameworkBName}</CardTitle>
          </CardHeader>
          <CardContent>
            <MappableControlTree
              roots={(treeB.data?.roots ?? []) as unknown as TreeControl[]}
              mappedIds={mappedIds}
              selectedId={selected?.side === "B" ? selected.control.id : null}
              onSelect={(c) => handlePick("B", c)}
            />
          </CardContent>
        </Card>
      </div>

      {selected && (
        <Card className="mt-4 border-dharma-accent bg-dharma-accent-tint">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-4 w-4 text-dharma-accent-on-tint" />
                AI Suggestions for &ldquo;{selected.control.title}&rdquo;
              </CardTitle>
              <button
                onClick={() => setSelected(null)}
                aria-label="Cancel selection"
                className="text-dharma-ink-secondary hover:text-dharma-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-dharma-ink-secondary">
              Select a control on the other side to map manually, or accept a suggestion below.
            </p>
            {suggestions.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (suggestions.data ?? []).length === 0 ? (
              <p className="text-xs text-dharma-ink-secondary">
                No AI suggestions available — this control may not be embedded yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {suggestions.data!.map((s) => (
                  <li
                    key={s.controlId}
                    className="flex items-center justify-between gap-3 rounded-md border border-dharma-border bg-dharma-bg px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-xs font-medium"
                        title={s.code ? `${s.code} — ${s.title}` : s.title}
                      >
                        {s.code && <span className="mr-1 font-mono text-dharma-ink-secondary">{s.code}</span>}
                        {s.title}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {Math.round(s.confidenceScore * 100)}% match
                    </Badge>
                    <Button size="sm" className="h-7 shrink-0 text-xs" onClick={() => acceptSuggestion(s)}>
                      Accept
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {pending && (
        <ConfirmMappingDialog
          pending={pending}
          isSubmitting={createMutation.isPending}
          error={createMutation.error?.message}
          onCancel={() => setPending(null)}
          onConfirm={(strength, rationale) => {
            createMutation.mutate({
              sourceControlId: pending.source.control.id,
              targetControlId: pending.target.control.id,
              mappingStrength: strength,
              rationale: rationale || undefined,
              suggestedByAI: pending.suggestedByAI,
              confidenceScore: pending.confidenceScore,
            });
          }}
        />
      )}
    </div>
  );
}

function ConfirmMappingDialog({
  pending,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}: {
  pending: PendingMapping;
  isSubmitting: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (strength: MappingStrength, rationale: string) => void;
}) {
  const [strength, setStrength] = useState<MappingStrength>(pending.defaultStrength);
  const [rationale, setRationale] = useState("");

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm cross-walk mapping</DialogTitle>
          <DialogDescription>
            {pending.source.control.title} ↔ {pending.target.control.title}
            {pending.suggestedByAI && (
              <span className="ml-2 inline-flex items-center gap-1 text-dharma-accent-on-tint">
                <Sparkles className="h-3 w-3" />
                AI-suggested ({Math.round((pending.confidenceScore ?? 0) * 100)}% match)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-dharma-ink-secondary">Mapping strength</label>
            <Select value={strength} onValueChange={(v) => setStrength(v as MappingStrength)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EQUIVALENT">Equivalent</SelectItem>
                <SelectItem value="PARTIAL">Partial</SelectItem>
                <SelectItem value="RELATED">Related</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-dharma-ink-secondary">Rationale (optional)</label>
            <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why these controls map…" />
          </div>
          {error && <p className="text-xs text-dharma-danger-text">{error}</p>}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(strength, rationale)} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Create mapping"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
