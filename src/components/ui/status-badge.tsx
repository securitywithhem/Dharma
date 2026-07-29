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

// Tinted treatment (12% wash + full-strength text) rather than a solid fill:
// these sit in dense tables, and five saturated blocks per row would fight the
// data for attention. Colours resolve from --severity-* only — never raw
// Tailwind palette values, so a white-label tenant recolouring the brand
// cannot shift what a severity means.
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-micro font-medium transition-colors duration-150",
  {
    variants: {
      severity: {
        NONE: "border-severity-none/25 bg-severity-none/[0.12] text-severity-none",
        LOW: "border-severity-low/25 bg-severity-low/[0.12] text-severity-low",
        MEDIUM: "border-severity-medium/25 bg-severity-medium/[0.12] text-severity-medium",
        HIGH: "border-severity-high/25 bg-severity-high/[0.12] text-severity-high",
        CRITICAL: "border-severity-critical/30 bg-severity-critical/[0.14] text-severity-critical",
      },
    },
    defaultVariants: { severity: "NONE" },
  },
);

const DOT_CLASS: Record<Severity, string> = {
  NONE: "bg-severity-none",
  LOW: "bg-severity-low",
  MEDIUM: "bg-severity-medium",
  HIGH: "bg-severity-high",
  CRITICAL: "bg-severity-critical",
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
