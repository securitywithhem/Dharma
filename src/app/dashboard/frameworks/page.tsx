"use client";

import { useState } from "react";
import { Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FrameworkCard } from "./FrameworkCard";
import { AddFrameworkModal } from "./AddFrameworkModal";

export default function FrameworksPage() {
  const [showAddModal, setShowAddModal] = useState(false);

  const frameworksQuery = api.framework.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const frameworks = frameworksQuery.data ?? [];
  const isLoading = frameworksQuery.isLoading;
  const isError = frameworksQuery.isError;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Compliance Frameworks
            </h1>
            {!isLoading && (
              <Badge variant="outline" className="text-xs">
                {frameworks.length} active
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm max-w-xl">
          Track your organisation&apos;s certification goals across DPDP Act
          2023, ISO 27001:2022, SOC 2 Type II, and custom requirements.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh frameworks"
            onClick={() => void frameworksQuery.refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            id="add-framework-btn"
            aria-label="Add compliance framework"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Framework
          </Button>
        </div>
      </div>

      {/* Loading skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && !isLoading && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <div className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle className="text-base">Failed to load frameworks</CardTitle>
            </div>
            <CardDescription>
              {frameworksQuery.error?.message ??
                "An unexpected error occurred. Please try again."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void frameworksQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && frameworks.length === 0 && (
        <div
          role="region"
          aria-label="No frameworks"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 px-6 text-center"
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <ShieldAlert className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">No frameworks activated yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">
            Add DPDP Act 2023, ISO 27001:2022, or SOC 2 Type II to begin
            tracking compliance. Controls will be seeded automatically.
          </p>
          <Button
            className="mt-6"
            onClick={() => setShowAddModal(true)}
            id="add-framework-empty-btn"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Framework
          </Button>
        </div>
      )}

      {/* Framework grid */}
      {!isLoading && !isError && frameworks.length > 0 && (
        <>
          {/* Overall summary bar */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: "Total Controls",
                value: frameworks.reduce((s, f) => s + f.controlCount, 0),
              },
              {
                label: "Compliant",
                value: frameworks.reduce((s, f) => s + f.compliantCount, 0),
                colour: "text-emerald-600 dark:text-emerald-400",
              },
              {
                label: "In Progress",
                value: frameworks.reduce((s, f) => s + f.inProgressCount, 0),
                colour: "text-amber-600 dark:text-amber-400",
              },
              {
                label: "Avg. Score",
                value: `${Math.round(frameworks.reduce((s, f) => s + f.progressPercentage, 0) / frameworks.length)}%`,
                colour: "text-primary",
              },
            ].map(({ label, value, colour }) => (
              <Card key={label} className="py-4 px-5">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p
                  className={`mt-1 text-2xl font-bold tabular-nums ${colour ?? ""}`}
                >
                  {value}
                </p>
              </Card>
            ))}
          </div>

          {/* Cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {frameworks.map((fw) => (
              <FrameworkCard key={fw.id} {...fw} />
            ))}
          </div>
        </>
      )}

      {/* Add framework modal */}
      {showAddModal && (
        <AddFrameworkModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            void frameworksQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
