import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Severity levels, mirroring the Prisma `Severity` enum
 * (packages/db/schema.prisma). Kept as the enum's own SCREAMING_CASE rather
 * than a prettier lowercase union so a value read straight off a Vulnerability
 * row can be passed through without a mapping step — every mapping step is a
 * place the ramp can drift.
 */
export const SEVERITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Tinted treatment rather than a solid fill: these sit in dense tables, and
// five saturated blocks per row would fight the data for attention.
//
// ---------------------------------------------------------------------------
// RAMP COMPRESSION — accepted cost, recorded 2026-07-29
//
// This previously resolved from a CVD-validated five-step --severity-* ramp,
// one step per Prisma `Severity` member. Warm Paper ships four flat semantic
// roles and no severity ramp, so five steps now map onto four roles:
//
//     NONE -> neutral   LOW -> info   MEDIUM -> warning
//     HIGH -> danger    CRITICAL -> danger
//
// HIGH and CRITICAL therefore share a hue. They are separated by border and
// weight only, which is a weaker signal than the ramp gave. The text label is
// what keeps this conforming — colour is not the sole channel (WCAG 1.4.1) —
// and it is now load-bearing rather than merely belt-and-braces, so it must
// never become icon-only.
//
// See 0_DESIGN_SYSTEM.md § Accepted costs (2).
// ---------------------------------------------------------------------------
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-dharma-sm border px-2 py-0.5 text-micro transition-colors duration-dharma-fast ease-dharma",
  {
    variants: {
      severity: {
        NONE: "border-dharma-border-strong bg-dharma-surface-hover text-dharma-ink-secondary font-medium",
        LOW: "border-dharma-info bg-dharma-info-bg text-dharma-info-text font-medium",
        // Ink label, not --dharma-warning-text: at 11px the specified warning
        // pair is 4.48:1 and conforms only as large text. Same reasoning as
        // the Badge `warning` variant.
        MEDIUM: "border-dharma-warning bg-dharma-warning-bg text-dharma-ink font-medium",
        HIGH: "border-dharma-danger bg-dharma-danger-bg text-dharma-danger-text font-medium",
        // Same hue as HIGH — carries the weight and the heavier rule instead.
        CRITICAL:
          "border-dharma-danger bg-dharma-danger-bg text-dharma-danger-text font-semibold ring-1 ring-inset ring-dharma-danger",
      },
    },
    defaultVariants: { severity: "NONE" },
  },
);

const DOT_CLASS: Record<Severity, string> = {
  NONE: "bg-dharma-ink-muted",
  LOW: "bg-dharma-info",
  MEDIUM: "bg-dharma-warning",
  HIGH: "bg-dharma-danger",
  CRITICAL: "bg-dharma-danger",
};

// Sentence case reads as prose in a table cell; SCREAMING_CASE shouts five
// times per row.
const LABEL: Record<Severity, string> = {
  NONE: "None",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    Omit<VariantProps<typeof statusBadgeVariants>, "severity"> {
  severity: Severity;
  /**
   * Optional count, for aggregate chips ("Critical 4"). Rendered in tabular
   * figures so stacked chips align down a column.
   */
  count?: number;
}

/**
 * The single severity chip for the whole app — vulnerabilities, pentest
 * findings, control status, connector health. Ad-hoc severity colouring is a
 * correctness bug, not a style preference: an auditor who learns the ramp on
 * one screen must read it identically on every other.
 *
 * The text label ALWAYS renders. Light mode forces every severity dark enough
 * to clear 4.5:1 on the card surface, which compresses lightness exactly where
 * MEDIUM (yellow) and HIGH (orange) sit at adjacent hues — under protanopia
 * those two steps stay close. The label is what keeps colour from being the
 * sole channel (WCAG 1.4.1), so it must not become icon-only.
 */
export function StatusBadge({ severity, count, className, ...props }: StatusBadgeProps) {
  const level: Severity = SEVERITIES.includes(severity) ? severity : "NONE";

  return (
    <span className={cn(statusBadgeVariants({ severity: level }), className)} {...props}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[level])} aria-hidden="true" />
      {LABEL[level]}
      {count !== undefined && (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </span>
  );
}

export { statusBadgeVariants };
