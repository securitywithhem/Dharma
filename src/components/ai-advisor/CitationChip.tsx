"use client";

/**
 * src/components/ai-advisor/CitationChip.tsx
 *
 * Phase 7 Part 3 — a clickable citation chip (4_UI_UX_DESIGN.md "Citations as
 * clickable chips"). Navigates to the referenced control/evidence detail page.
 *
 * Defense-in-depth: a chip only renders as a navigable link when its target id
 * is in the `allowedIds` allow-list (the ids the org-scoped backend actually
 * returned for this message) AND the id is well-formed. An unrecognized or
 * malformed id renders as an inert chip, never a link — so a stray marker in
 * model output can't become a link to an arbitrary/other-org id. The
 * destination page still enforces org ownership server-side (the real boundary).
 */

import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";
import type { CitationType } from "@/lib/ai/parseCitations";

const ID_RE = /^[A-Za-z0-9_-]+$/;

const ROUTE_BY_TYPE: Partial<Record<CitationType, (id: string) => string>> = {
  control: (id) => `/dashboard/controls/${id}`,
  evidence: (id) => `/dashboard/evidence/${id}`,
};

export interface CitationChipProps {
  type: CitationType;
  id: string;
  /** Ids the backend cited for this message; only these become links. */
  allowedIds?: Set<string>;
  label?: string;
}

export function CitationChip({ type, id, allowedIds, label }: CitationChipProps) {
  const text = label ?? `${type === "control" ? "Control" : type === "evidence" ? "Evidence" : "Source"} ${id.slice(0, 8)}`;
  const routeFor = ROUTE_BY_TYPE[type];
  const isNavigable = !!routeFor && ID_RE.test(id) && (!allowedIds || allowedIds.has(id));

  const baseClass = cn(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium align-baseline mx-0.5",
    "border-primary/30 bg-primary/10 text-primary",
  );

  if (!isNavigable) {
    return (
      <span className={cn(baseClass, "cursor-default opacity-90")} title={`${type}:${id}`} data-citation-inert="true">
        {text}
      </span>
    );
  }

  return (
    <Link
      href={routeFor!(id) as Route}
      className={cn(baseClass, "hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring")}
      aria-label={`Open ${type} ${id}`}
      data-citation-link="true"
    >
      {text}
    </Link>
  );
}
