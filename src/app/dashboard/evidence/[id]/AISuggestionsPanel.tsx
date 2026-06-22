"use client";

/**
 * AISuggestionsPanel.tsx
 *
 * Displays AI-powered control recommendations for a given evidence item.
 *
 * Behaviour:
 *  1. On mount, call `evidence.getAIRecommendations`.
 *  2. While status === 'PENDING_ANALYSIS', show a pulsing loader and poll every 3 s.
 *  3. When status === 'READY', render the top-3 recommended controls.
 *  4. "Accept" button calls `evidence.acceptMapping` — re-links the evidence to the
 *     chosen control, conditionally advances control status, writes audit log.
 *     On success: card shows a green ✓ badge and a link to the control page.
 *  5. "Reject" button (X icon) locally dismisses the card — no DB write, per spec.
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface Recommendation {
  id: string;
  title: string;
  domain: string;
  description: string;
  distance: number;
  matchPercentage: number;
}

export interface AISuggestionsPanelProps {
  evidenceId: string;
  organizationId: string;
  /** The controlId currently linked to this evidence — used to highlight
   *  cards that are already the linked control so the user doesn't re-map. */
  currentControlId?: string | null;
}

// ------------------------------------------------------------------
// Sub-components — Loading / Empty / Error states
// ------------------------------------------------------------------

function PendingState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <div
        className="relative flex items-center justify-center h-14 w-14 rounded-full bg-amber-500/10"
        aria-hidden="true"
      >
        <span className="absolute inset-0 rounded-full animate-ping bg-amber-500/20" />
        <Brain className="h-6 w-6 text-amber-500" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">Analyzing evidence…</p>
        <p className="text-xs text-muted-foreground">
          Extracting text and generating embeddings
        </p>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground max-w-[200px]">
        No recommendations found. Try refreshing after the embedding completes.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
      <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </div>
      <p className="text-sm font-medium text-destructive">Analysis failed</p>
      <p className="text-xs text-muted-foreground">
        The AI pipeline could not process this file.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
        Retry
      </Button>
    </div>
  );
}

/** Progress-bar and chip colour based on match quality */
function matchColour(pct: number) {
  if (pct >= 75) return { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" };
  if (pct >= 50) return { bar: "bg-amber-500",   chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" };
  return          { bar: "bg-orange-400",         chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" };
}

// ------------------------------------------------------------------
// Recommendation card
// ------------------------------------------------------------------

interface RecommendationCardProps {
  rec: Recommendation;
  /** Already the currently-linked control for this evidence */
  isCurrentControl: boolean;
  /** User accepted this mapping in the current session */
  isAccepted: boolean;
  /** accept mutation is in-flight for this card */
  isAccepting: boolean;
  /** User rejected this card (should be hidden by parent) */
  onAccept: () => void;
  onReject: () => void;
}

function RecommendationCard({
  rec,
  isCurrentControl,
  isAccepted,
  isAccepting,
  onAccept,
  onReject,
}: RecommendationCardProps) {
  const colours = matchColour(rec.matchPercentage);
  const alreadyMapped = isCurrentControl || isAccepted;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 space-y-2.5 transition-all duration-200",
        alreadyMapped && "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20",
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug truncate" title={rec.title}>
            {rec.title}
          </p>
          <Badge
            className="mt-1 text-[10px] h-4 px-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-none"
          >
            {rec.domain}
          </Badge>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Match % chip */}
          <span
            className={cn(
              "text-xs font-semibold tabular-nums rounded-full px-2 py-0.5",
              colours.chip,
            )}
          >
            {rec.matchPercentage}%
          </span>

          {/* Reject button — hidden when already mapped */}
          {!alreadyMapped && (
            <button
              type="button"
              onClick={onReject}
              className="h-5 w-5 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label={`Dismiss recommendation: ${rec.title}`}
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "absolute left-0 top-0 h-full rounded-full transition-all duration-700",
            colours.bar,
          )}
          style={{ width: `${Math.max(rec.matchPercentage, 4)}%` }}
        />
      </div>

      {/* Description snippet */}
      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
        {rec.description}
      </p>

      {/* Action row */}
      {alreadyMapped ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">
              {isCurrentControl && !isAccepted ? "Currently linked" : "Accepted"}
            </span>
          </div>
          <Link
            href={`/dashboard/frameworks`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`View control: ${rec.title}`}
          >
            View control
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white border-none"
          onClick={onAccept}
          disabled={isAccepting}
          id={`accept-control-${rec.id}`}
          aria-label={`Accept mapping to control: ${rec.title}`}
        >
          {isAccepting ? (
            <>
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              Mapping…
            </>
          ) : (
            <>
              <Zap className="h-3 w-3 mr-1.5" />
              Accept Mapping
            </>
          )}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Main panel
// ------------------------------------------------------------------

export function AISuggestionsPanel({
  evidenceId,
  organizationId,
  currentControlId,
}: AISuggestionsPanelProps) {
  const [acceptedControlId, setAcceptedControlId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const utils = api.useUtils();

  // ----- tRPC queries -----

  const recommendationsQuery = api.evidence.getAIRecommendations.useQuery(
    { evidenceId },
    { staleTime: 0, refetchOnWindowFocus: false, retry: 2 },
  );

  const requestMappingMutation = api.evidence.requestAIMapping.useMutation({
    onSuccess: () => void recommendationsQuery.refetch(),
    onError: (err) =>
      toast.error("Failed to start AI analysis", { description: err.message }),
  });

  const acceptMappingMutation = api.evidence.acceptMapping.useMutation({
    onSuccess: (data) => {
      toast.success(`Evidence mapped to "${data.control.title}"`, {
        description:
          data.control.status === "IN_PROGRESS"
            ? "Control status advanced to In Progress."
            : `Control status: ${data.control.status.replace(/_/g, " ")}.`,
        duration: 5000,
      });
      // Refresh evidence detail (Linked Control card updates automatically)
      void utils.evidence.getById.invalidate({ id: evidenceId });
      // Refresh both old and new control caches
      void utils.control.getById.invalidate({ id: data.control.id });
      if (currentControlId && currentControlId !== data.control.id) {
        void utils.control.getById.invalidate({ id: currentControlId });
      }
      // Refresh framework list so compliance % updates
      void utils.framework.list.invalidate();
    },
    onError: (err) =>
      toast.error("Failed to accept mapping", { description: err.message }),
  });

  // ----- Polling while PENDING -----

  const isPending =
    recommendationsQuery.data?.status === "PENDING_ANALYSIS" ||
    (!recommendationsQuery.data && !recommendationsQuery.isError);

  useEffect(() => {
    if (isPending && !recommendationsQuery.isError) {
      pollRef.current = setInterval(
        () => void recommendationsQuery.refetch(),
        3000,
      );
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isPending, recommendationsQuery.isError, recommendationsQuery]);

  // ----- Handlers -----

  function handleAccept(controlId: string) {
    setAcceptingId(controlId);
    acceptMappingMutation.mutate(
      { evidenceId, controlId },
      {
        onSettled: () => setAcceptingId(null),
        onSuccess: () => setAcceptedControlId(controlId),
      },
    );
  }

  function handleReject(controlId: string) {
    setRejectedIds((prev) => new Set([...prev, controlId]));
  }

  // ----- Render -----

  const status = recommendationsQuery.data?.status;
  const allRecs = recommendationsQuery.data?.recommendations ?? [];
  // Filter out locally-rejected cards
  const visibleRecs = allRecs.filter((r) => !rejectedIds.has(r.id));

  return (
    <Card
      className="w-full shadow-sm"
      id="ai-suggestions-panel"
      aria-label="AI Recommendations Panel"
    >
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-amber-500/10 flex items-center justify-center">
              <Brain className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <CardTitle className="text-sm font-semibold">
              AI Recommendations
            </CardTitle>
          </div>

          <div className="flex items-center gap-1.5">
            {status === "READY" && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-emerald-300 text-emerald-600 dark:text-emerald-400"
              >
                Ready
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void recommendationsQuery.refetch()}
              disabled={recommendationsQuery.isFetching}
              aria-label="Refresh AI recommendations"
              id="ai-recommendations-refresh"
            >
              <RotateCcw
                className={cn(
                  "h-3.5 w-3.5",
                  recommendationsQuery.isFetching && "animate-spin",
                )}
              />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Request analysis button (shown before the first query result arrives) */}
        {!recommendationsQuery.data &&
          !recommendationsQuery.isFetching &&
          !recommendationsQuery.isError && (
            <div className="text-center py-2">
              <Button
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-white text-xs"
                onClick={() => requestMappingMutation.mutate({ evidenceId })}
                disabled={requestMappingMutation.isPending}
                id="request-ai-mapping-btn"
                aria-label="Request AI mapping for this evidence"
              >
                {requestMappingMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Queuing…
                  </>
                ) : (
                  <>
                    <Brain className="h-3.5 w-3.5 mr-1.5" />
                    Request AI Mapping
                  </>
                )}
              </Button>
            </div>
          )}

        {/* Pending / loading */}
        {(recommendationsQuery.isFetching && !recommendationsQuery.data) ||
        status === "PENDING_ANALYSIS" ? (
          <PendingState />
        ) : null}

        {/* Error */}
        {recommendationsQuery.isError && !recommendationsQuery.isFetching && (
          <ErrorState onRetry={() => void recommendationsQuery.refetch()} />
        )}

        {/* Empty — all cards were either rejected or none returned */}
        {status === "READY" && visibleRecs.length === 0 && allRecs.length === 0 && (
          <EmptyState />
        )}

        {/* All-dismissed state */}
        {status === "READY" && visibleRecs.length === 0 && allRecs.length > 0 && (
          <div className="text-center py-6">
            <p className="text-xs text-muted-foreground">All suggestions dismissed.</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs"
              onClick={() => setRejectedIds(new Set())}
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Show again
            </Button>
          </div>
        )}

        {/* Recommendations list */}
        {status === "READY" && visibleRecs.length > 0 && (
          <div className="space-y-2">
            {visibleRecs.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                isCurrentControl={currentControlId === rec.id}
                isAccepted={acceptedControlId === rec.id}
                isAccepting={acceptingId === rec.id}
                onAccept={() => handleAccept(rec.id)}
                onReject={() => handleReject(rec.id)}
              />
            ))}

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Powered by Ollama · nomic-embed-text · pgvector
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
