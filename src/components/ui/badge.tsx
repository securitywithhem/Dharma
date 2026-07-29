import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Status chips are squared rather than fully-rounded pills. Pills read as
// consumer-social; a compliance console reads as a record, and the flatter
// corner matches the table rules these sit next to.
//
// Warm Paper. Every variant is the spec's mandated pairing — a `{role}-bg`
// wash with `{role}-text` on top, never a saturated fill with white text.
//
// The washes are flat `-bg` tokens rather than the old `/12` opacity
// modifiers: the tokens are hex, so Tailwind's opacity modifier does not
// compile against them. A `bg-dharma-success` with a `/12` modifier would
// silently produce no background at all.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-dharma-sm border px-2 py-0.5 text-micro font-medium transition-colors duration-dharma-fast ease-dharma focus:outline-none focus:ring-2 focus:ring-dharma-accent focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-dharma-accent bg-dharma-accent-tint text-dharma-accent-on-tint",
        secondary:
          "border-transparent bg-dharma-surface-hover text-dharma-ink-secondary",
        outline: "border-dharma-border-strong text-dharma-ink",
        success:
          "border-dharma-success bg-dharma-success-bg text-dharma-success-text",
        /**
         * ACCESSIBILITY DEVIATION — deliberate, do not "fix" back.
         *
         * The spec pairs warning text #8C5E1F on #F1E4CD, which measures
         * 4.48:1 — 0.02 short of the 4.5 normal-text floor, conforming only
         * under the large-text rule (>=18.66px bold / >=24px regular). A chip
         * renders at text-micro (11px), so the specified pair cannot conform
         * here at any weight.
         *
         * The label therefore uses --dharma-text-primary (ink) on the warning
         * wash: 13.34:1. No spec hex was altered — an existing token is
         * substituted for one that does not fit this size class. The dot keeps
         * --dharma-warning-base so the role still reads as warning.
         *
         * `text-dharma-warning-text` remains correct for warning copy set at
         * large sizes; see 0_DESIGN_SYSTEM.md § Accessibility reconciliations.
         */
        warning: "border-dharma-warning bg-dharma-warning-bg text-dharma-ink",
        critical:
          "border-dharma-danger bg-dharma-danger-bg text-dharma-danger-text",
        info: "border-dharma-info bg-dharma-info-bg text-dharma-info-text",
        /** Alias of `critical` — same role, kept for existing call sites. */
        destructive:
          "border-dharma-danger bg-dharma-danger-bg text-dharma-danger-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
