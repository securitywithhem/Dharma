"use client";

/**
 * Review queue for machine-proposed cross-walk mappings.
 *
 * These rows exist at status PROPOSED and are excluded from readiness scoring,
 * the compliance graph and the advisor's context until accepted here. Accepting
 * one is a compliance assertion — it can raise the framework's readiness score —
 * so the confidence figure and both control titles are shown in full rather
 * than summarised.
 */

import { useState } from "react";
import { api } from "@/hooks/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ProposalReviewPanelProps {
  frameworkAId: string;
  frameworkBId: string;
  frameworkAName: string;
  frameworkBName: string;
}

const THRESHOLDS = [0.95, 0.9, 0.85, 0.8] as const;

export function ProposalReviewPanel({
  frameworkAId,
  frameworkBId,
  frameworkAName,
  frameworkBName,
}: ProposalReviewPanelProps) {
  const utils = api.useUtils();
  const [minConfidence, setMinConfidence] = useState<number | undefined>(undefined);

  const proposals = api.controlMapping.listProposals.useQuery({
    frameworkAId,
    frameworkBId,
    minConfidence,
  });

  const invalidate = async () => {
    await Promise.all([
      utils.controlMapping.listProposals.invalidate(),
      utils.controlMapping.listForFrameworkPair.invalidate(),
      utils.controlMapping.getOverlapMatrix.invalidate(),
    ]);
  };

  const review = api.controlMapping.review.useMutation({ onSuccess: invalidate });
  const bulkReview = api.controlMapping.bulkReview.useMutation({ onSuccess: invalidate });

  const propose = api.controlMapping.proposeForFrameworkPair.useMutation({
    onSuccess: invalidate,
  });

  const busy = review.isPending || bulkReview.isPending || propose.isPending;
  const items = proposals.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-dharma-ink">Proposed mappings</h2>
          <p className="text-xs text-dharma-ink-secondary">
            Suggested by embedding similarity. Nothing here affects your compliance score until
            you accept it.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            propose.mutate({ sourceFrameworkId: frameworkAId, targetFrameworkId: frameworkBId })
          }
          data-testid="suggest-mappings"
        >
          {propose.isPending ? "Analysing…" : "Suggest mappings"}
        </Button>
      </div>

      {propose.data && (
        <div role="status" className="rounded-md border border-dharma-border bg-dharma-surface p-3 text-xs">
          Proposed <strong>{propose.data.proposed}</strong> mapping
          {propose.data.proposed === 1 ? "" : "s"} from {propose.data.scanned} embedded control
          {propose.data.scanned === 1 ? "" : "s"}.
          {propose.data.skippedExisting > 0 && ` ${propose.data.skippedExisting} already existed.`}
          {/* The single most confusing failure mode this feature has: an empty
              result because nothing is embedded reads as "the AI found nothing".
              Say which it is. */}
          {propose.data.unembedded > 0 && (
            <span className="mt-1 block text-dharma-warning-text">
              {propose.data.unembedded} control{propose.data.unembedded === 1 ? " has" : "s have"} no
              embedding yet and {propose.data.unembedded === 1 ? "was" : "were"} skipped. Run{" "}
              <code className="font-mono">npm run backfill:control-embeddings</code> to include{" "}
              {propose.data.unembedded === 1 ? "it" : "them"}.
            </span>
          )}
          {propose.data.truncated && (
            <span className="mt-1 block">
              Stopped at the proposal cap — run again after reviewing these.
            </span>
          )}
        </div>
      )}

      {propose.error && (
        <p role="alert" className="text-xs text-dharma-danger-text">
          {propose.error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-dharma-ink-secondary">Minimum confidence:</span>
        <Button
          size="sm"
          variant={minConfidence === undefined ? "default" : "outline"}
          onClick={() => setMinConfidence(undefined)}
        >
          All
        </Button>
        {THRESHOLDS.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={minConfidence === t ? "default" : "outline"}
            onClick={() => setMinConfidence(t)}
          >
            ≥ {Math.round(t * 100)}%
          </Button>
        ))}

        {items.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={busy}
            onClick={() =>
              bulkReview.mutate({ ids: items.map((p) => p.id), decision: "ACCEPTED" })
            }
            data-testid="accept-all-shown"
          >
            Accept all {items.length} shown
          </Button>
        )}
      </div>

      {proposals.isPending && <p className="text-xs text-dharma-ink-secondary">Loading proposals…</p>}

      {proposals.isSuccess && items.length === 0 && (
        <p className="text-xs text-dharma-ink-secondary">
          No proposals pending review. Use “Suggest mappings” to generate some.
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-dharma-ink-secondary">
              <tr>
                <th className="py-2 pr-3 font-medium">{frameworkAName}</th>
                <th className="py-2 pr-3 font-medium">{frameworkBName}</th>
                <th className="py-2 pr-3 font-medium">Confidence</th>
                <th className="py-2 pr-3 font-medium">Strength</th>
                <th className="py-2 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-dharma-border align-top">
                  <td className="py-2 pr-3">
                    <span className="font-mono text-[10px] text-dharma-ink-secondary">
                      {p.sourceControl.code ?? p.sourceControl.domain}
                    </span>
                    <div>{p.sourceControl.title}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-[10px] text-dharma-ink-secondary">
                      {p.targetControl.code ?? p.targetControl.domain}
                    </span>
                    <div>{p.targetControl.title}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {p.confidenceScore !== null
                      ? `${Math.round(p.confidenceScore * 100)}%`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline">{p.mappingStrength}</Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => review.mutate({ id: p.id, decision: "ACCEPTED" })}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => review.mutate({ id: p.id, decision: "REJECTED" })}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(review.error || bulkReview.error) && (
        <p role="alert" className="text-xs text-dharma-danger-text">
          {review.error?.message ?? bulkReview.error?.message}
        </p>
      )}
    </div>
  );
}
