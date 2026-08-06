"use client";

/**
 * WAVE 9.2 — the shared "this failed to load" state.
 *
 * fullstack-audit-2026-08-06 §6 HIGH-1: error handling correlated with which
 * sprint touched a module rather than with importance. The seven modules
 * b0199f1/b24726c polished branch on the query's error; the rest render their
 * skeleton straight into an empty/zero state, so a backend outage reads as
 * "0 frameworks, 0 evidence, 0% ready" — a statement about the user's
 * compliance posture rather than about a failed request. For a compliance
 * product that is actively misleading, not merely unpolished.
 *
 * A shared component rather than an eighth hand-rolled copy, because the audit's
 * pattern P1 is precisely that this repo builds a control once and never
 * generalises it. Anything that needs the same treatment imports this.
 */

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface QueryErrorProps {
  /** What failed, in the user's terms: "Failed to load frameworks". */
  title: string;
  /** The server's message, when there is one. */
  message?: string | null;
  /** Wire to `query.refetch`. Omit only when a retry genuinely cannot help. */
  onRetry?: () => void;
  /** Tighter padding for in-card and side-panel slots. */
  compact?: boolean;
  className?: string;
}

export function QueryError({
  title,
  message,
  onRetry,
  compact = false,
  className,
}: QueryErrorProps) {
  return (
    <Card className={cn("border-dharma-danger bg-dharma-danger-bg", className)}>
      <CardHeader className={compact ? "py-3" : undefined}>
        <div className="flex items-center gap-2 text-dharma-danger-text">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        <CardDescription>
          {/* The server's message when we have one, never a bare "error". A
              user who cannot tell an outage from a permission problem cannot
              decide whether to retry or to call someone. */}
          {message ?? "The request did not complete. This is a problem on our side, not with your data."}
        </CardDescription>
      </CardHeader>
      {onRetry && (
        <CardContent className={compact ? "pt-0 pb-3" : undefined}>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
