"use client";

import { useState } from "react";
import { ArrowLeft, Grid3x3, ListTree, Sparkles } from "lucide-react";
import { api } from "@/hooks/trpc";
import { QueryError } from "@/components/ui/query-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FrameworkPairSelector } from "@/components/crosswalk/FrameworkPairSelector";
import { OverlapHeatmap } from "@/components/crosswalk/OverlapHeatmap";
import { CrossWalkPicker } from "@/components/crosswalk/CrossWalkPicker";
import { ProposalReviewPanel } from "@/components/crosswalk/ProposalReviewPanel";

type ViewMode = "heatmap" | "picker" | "review";

export default function CrossWalkPage() {
  const [frameworkAId, setFrameworkAId] = useState<string | null>(null);
  const [frameworkBId, setFrameworkBId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("heatmap");
  const [drillDown, setDrillDown] = useState<{ familyAId: string; familyBId: string } | null>(null);

  const frameworksQuery = api.framework.list.useQuery();
  const frameworks = frameworksQuery.data;
  const frameworkAName = frameworks?.find((f) => f.id === frameworkAId)?.name ?? "Framework A";
  const frameworkBName = frameworks?.find((f) => f.id === frameworkBId)?.name ?? "Framework B";

  const bothSelected = !!frameworkAId && !!frameworkBId;

  // Badge count so a queue of pending proposals is discoverable rather than
  // hidden behind a tab nobody has a reason to click.
  const proposalCount = api.controlMapping.listProposals.useQuery(
    { frameworkAId: frameworkAId!, frameworkBId: frameworkBId! },
    { enabled: bothSelected },
  );
  const pendingProposals = proposalCount.data?.length ?? 0;

  // WAVE 9.2 (§6 HIGH-1) — this page had no loading, error or empty state at
  // all. Without the framework list the pair selector renders empty, which
  // reads as "you have no frameworks" rather than "we could not load them".
  if (frameworksQuery.isError) {
    return (
      <QueryError
        title="Failed to load frameworks"
        message={frameworksQuery.error?.message}
        onRetry={() => frameworksQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cross-Walk Mapping</h1>
        <p className="text-sm text-dharma-ink-secondary">
          Map equivalent controls between frameworks and see coverage overlap at a glance.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <FrameworkPairSelector
            frameworkAId={frameworkAId}
            frameworkBId={frameworkBId}
            onChange={({ frameworkAId: a, frameworkBId: b }) => {
              setFrameworkAId(a);
              setFrameworkBId(b);
              setDrillDown(null);
            }}
          />

          {bothSelected && (
            <div className="flex rounded-md border border-dharma-border p-0.5" role="group" aria-label="Cross-walk view">
              <Button
                variant={view === "heatmap" ? "default" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                aria-pressed={view === "heatmap"}
                onClick={() => setView("heatmap")}
              >
                <Grid3x3 className="h-3.5 w-3.5" />
                Overlap Heatmap
              </Button>
              <Button
                variant={view === "picker" ? "default" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                aria-pressed={view === "picker"}
                onClick={() => setView("picker")}
              >
                <ListTree className="h-3.5 w-3.5" />
                Mapping Picker
              </Button>
              <Button
                variant={view === "review" ? "default" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                aria-pressed={view === "review"}
                onClick={() => setView("review")}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Proposals
                {pendingProposals > 0 && (
                  <span className="ml-0.5 rounded-full bg-dharma-accent px-1.5 text-[10px] font-semibold text-white">
                    {pendingProposals}
                  </span>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!bothSelected ? (
        <div className="rounded-lg border border-dashed border-dharma-border py-16 text-center">
          <Grid3x3 className="mx-auto h-8 w-8 text-dharma-ink-secondary" />
          <p className="mt-3 text-sm font-medium">Choose two frameworks to compare</p>
          <p className="mt-1 text-xs text-dharma-ink-secondary">
            Select a Framework A and Framework B above to see their overlap and build mappings.
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {frameworkAName} × {frameworkBName}
              </CardTitle>
              {drillDown && view === "picker" && (
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDrillDown(null)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Clear drill-down
                </Button>
              )}
            </div>
            {drillDown && view === "picker" && (
              <p className="text-xs text-dharma-ink-secondary">
                Drilled in from the heatmap cell — showing the full mapping picker below.
              </p>
            )}
          </CardHeader>
          <CardContent>
            {view === "heatmap" ? (
              <OverlapHeatmap
                frameworkAId={frameworkAId!}
                frameworkBId={frameworkBId!}
                onDrillDown={(familyAId, familyBId) => {
                  setDrillDown({ familyAId, familyBId });
                  setView("picker");
                }}
              />
            ) : view === "review" ? (
              <ProposalReviewPanel
                frameworkAId={frameworkAId!}
                frameworkBId={frameworkBId!}
                frameworkAName={frameworkAName}
                frameworkBName={frameworkBName}
              />
            ) : (
              <CrossWalkPicker
                frameworkAId={frameworkAId!}
                frameworkBId={frameworkBId!}
                frameworkAName={frameworkAName}
                frameworkBName={frameworkBName}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
