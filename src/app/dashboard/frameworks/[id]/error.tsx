"use client";

/**
 * Segment-level boundary for a single framework's detail page.
 *
 * The dashboard already has a boundary one level up, but it replaces the whole
 * dashboard view. This route is the entry point to the evidence-upload loop —
 * the audit's P0 — so a failure here should stay contained: the shell and
 * navigation remain usable, and the user gets a retry plus a way back to the
 * framework list rather than a dead end.
 */

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FrameworkDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[framework-detail]", error);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-dharma-danger-text" />
            This framework could not be loaded
          </CardTitle>
          <CardDescription>
            Its controls and evidence are unavailable right now. Retrying usually resolves a
            transient failure.
            {error.digest ? ` Reference: ${error.digest}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={reset}>Retry</Button>
          {/* This Button does not support `asChild`, so the link carries the
              variant classes directly rather than nesting an <a> in a <button>. */}
          <Link href="/dashboard/frameworks" className={buttonVariants({ variant: "outline" })}>
            Back to frameworks
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
