"use client";

import { useState } from "react";
import { ArrowLeft, Grid3x3, ListTree } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FrameworkPairSelector } from "@/components/crosswalk/FrameworkPairSelector";
import { OverlapHeatmap } from "@/components/crosswalk/OverlapHeatmap";
import { CrossWalkPicker } from "@/components/crosswalk/CrossWalkPicker";

type ViewMode = "heatmap" | "picker";

export default function CrossWalkPage() {
  const [frameworkAId, setFrameworkAId] = useState<string | null>(null);
  const [frameworkBId, setFrameworkBId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("heatmap");
  const [drillDown, setDrillDown] = useState<{ familyAId: string; familyBId: string } | null>(null);

  const { data: frameworks } = api.framework.list.useQuery();
  const frameworkAName = frameworks?.find((f) => f.id === frameworkAId)?.name ?? "Framework A";
  const frameworkBName = frameworks?.find((f) => f.id === frameworkBId)?.name ?? "Framework B";

  const bothSelected = !!frameworkAId && !!frameworkBId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cross-Walk Mapping</h1>
        <p className="text-sm text-muted-foreground">
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
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Cross-walk view">
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
            </div>
          )}
        </CardContent>
      </Card>

      {!bothSelected ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Grid3x3 className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium">Choose two frameworks to compare</p>
          <p className="mt-1 text-xs text-muted-foreground">
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
              <p className="text-xs text-muted-foreground">
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
