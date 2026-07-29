"use client";

import Link from "next/link";
import type { Route } from "next";
import type { RecommendationType } from "@prisma/client";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  Link2Off,
  X,
} from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface RecommendationsListProps {
  frameworkId: string;
}

const TYPE_META: Record<RecommendationType, { label: string; icon: typeof AlertTriangle; className: string }> = {
  FAMILY_LOW_COVERAGE: { label: "Low Family Coverage", icon: AlertTriangle, className: "border-dharma-danger text-dharma-danger-text" },
  MISSING_EVIDENCE: { label: "Missing Evidence", icon: FileWarning, className: "border-dharma-warning text-dharma-ink" },
  STALE_EVIDENCE: { label: "Stale Evidence", icon: Clock, className: "border-dharma-accent text-dharma-accent-on-tint" },
  UNMAPPED_HIGH_VALUE_CONTROL: { label: "Weak Cross-Walk", icon: Link2Off, className: "border-chart-5/30 text-chart-5" },
};

export function RecommendationsList({ frameworkId }: RecommendationsListProps) {
  const utils = api.useUtils();
  const { data, isLoading } = api.readiness.getRecommendations.useQuery({ frameworkId });
  const dismissMutation = api.readiness.dismissRecommendation.useMutation({
    onSuccess: () => utils.readiness.getRecommendations.invalidate({ frameworkId }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-dharma-border py-10 text-center text-sm text-dharma-ink-secondary">
        No open recommendations — great shape!
      </div>
    );
  }

  const grouped = data.reduce<Record<string, typeof data>>((acc, rec) => {
    (acc[rec.type] ??= []).push(rec);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([type, recs]) => {
        const meta = TYPE_META[type as RecommendationType];
        const Icon = meta.icon;
        return (
          <div key={type}>
            <h4 className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", meta.className)}>
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
              <Badge variant="outline" className="ml-1 text-[10px]">{recs.length}</Badge>
            </h4>
            <div className="space-y-2">
              {recs.map((rec) => (
                <Card key={rec.id} className="border-dharma-border">
                  <CardContent className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{rec.title}</p>
                      <p className="mt-0.5 text-xs text-dharma-ink-secondary">{rec.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {rec.potentialScoreGain != null && (
                        <Badge variant="success" className="text-[10px]">
                          +{rec.potentialScoreGain} pts
                        </Badge>
                      )}
                      <div className="flex items-center gap-1">
                        {rec.control && (
                          <Link href={`/dashboard/controls/${rec.control.id}` as Route}>
                            <Button variant="ghost" size="sm" className="h-7 text-xs">
                              View control
                            </Button>
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-dharma-ink-secondary hover:text-dharma-danger-text"
                          aria-label="Dismiss recommendation"
                          disabled={dismissMutation.isPending}
                          onClick={() => dismissMutation.mutate({ id: rec.id })}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
