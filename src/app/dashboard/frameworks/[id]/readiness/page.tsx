"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "@/hooks/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreGauge } from "@/components/readiness/ScoreGauge";
import { FamilyBreakdownTable } from "@/components/readiness/FamilyBreakdownTable";
import { RecommendationsList } from "@/components/readiness/RecommendationsList";

const RECOMPUTE_COOLDOWN_MS = 60_000;
const POLL_INTERVAL_MS = 3000;

interface ReadinessPageProps {
  params: Promise<{ id: string }>;
}

export default function ReadinessPage({ params }: ReadinessPageProps) {
  const { id: frameworkId } = use(params);
  const utils = api.useUtils();

  const { data: framework } = api.framework.getById.useQuery({ id: frameworkId });

  const [pollingEnabled, setPollingEnabled] = useState(true);
  const { data: scoreData, isLoading } = api.readiness.getScore.useQuery(
    { frameworkId },
    { refetchInterval: pollingEnabled ? POLL_INTERVAL_MS : false },
  );

  useEffect(() => {
    setPollingEnabled(scoreData?.status === "computing" || !scoreData);
  }, [scoreData]);

  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);
  useEffect(() => {
    if (!cooldownUntil) return;
    const interval = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const recomputeMutation = api.readiness.recompute.useMutation({
    onSuccess: async () => {
      setCooldownUntil(Date.now() + RECOMPUTE_COOLDOWN_MS);
      setPollingEnabled(true);
      await utils.readiness.getScore.invalidate({ frameworkId });
    },
  });

  const remainingCooldownMs = cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;
  const onCooldown = remainingCooldownMs > 0;
  void cooldownTick; // re-render tick to keep remainingCooldownMs fresh

  const isComputing = scoreData?.status === "computing";
  const isReady = scoreData?.status === "ready";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/frameworks/${frameworkId}`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {framework?.name ?? "Framework"}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Audit Readiness</h1>
        <p className="text-sm text-muted-foreground">
          Evidence completeness weighted by cross-walk mapping coverage, with actionable next steps.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Overall Score</CardTitle>
            {isComputing && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                Computing…
              </span>
            )}
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pb-6">
            {isLoading || isComputing ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Skeleton className="h-[140px] w-[140px] rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            ) : (
              <ScoreGauge score={scoreData && "overallScore" in scoreData ? scoreData.overallScore : 0} />
            )}

            {isReady && "evidenceScore" in scoreData && (
              <div className="grid w-full grid-cols-2 gap-2 text-center text-xs text-muted-foreground">
                <div>
                  <p className="font-semibold text-foreground">{scoreData.evidenceScore}</p>
                  <p>Evidence (0-85)</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">{scoreData.mappingBonus}</p>
                  <p>Cross-walk bonus (0-15)</p>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 gap-1.5 text-xs"
              disabled={onCooldown || recomputeMutation.isPending || isComputing}
              onClick={() => recomputeMutation.mutate({ frameworkId })}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (recomputeMutation.isPending || isComputing) && "animate-spin")} />
              {onCooldown ? `Recompute (${Math.ceil(remainingCooldownMs / 1000)}s)` : "Recompute now"}
            </Button>

            {isReady && "computedAt" in scoreData && (
              <p className="text-[10px] text-muted-foreground">
                Last computed {new Date(scoreData.computedAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Coverage by Family</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading || isComputing || !isReady ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <FamilyBreakdownTable frameworkId={frameworkId} families={scoreData.breakdown.families} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <RecommendationsList frameworkId={frameworkId} />
        </CardContent>
      </Card>
    </div>
  );
}
