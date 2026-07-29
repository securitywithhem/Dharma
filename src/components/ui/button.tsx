import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Warm Paper. Every fill is flat — the elevation utility was removed from all
// variants per restraint rule 1 (no shadow/gradient/blur); depth is the
// hairline border.
//
// The focus ring uses the accent rather than a border token: neither
// --dharma-surface-border (1.35:1) nor -border-strong (1.53:1) clears the 3:1
// WCAG 1.4.11 floor, so neither may be the sole indicator of focus.
const buttonVariants = cva(
  // Transitions are scoped to the properties that actually change — the old
  // global `* { transition-colors }` in globals.css made every element in the
  // tree transition, which is both a paint cost and a visible lag on theme
  // switch. `active:translate-y-px` gives a physical press without motion libs.
  [
    "inline-flex items-center justify-center whitespace-nowrap gap-2",
    "rounded-dharma-md text-sm font-medium",
    "transition-[background-color,border-color,color,transform] duration-dharma-fast ease-dharma",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent focus-visible:ring-offset-2 ring-offset-dharma-bg",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        /**
         * THE accent. This is the one filled terracotta element a screen is
         * allowed — see the one-accent budget in 0_DESIGN_SYSTEM.md. If a view
         * renders two `default` Buttons, one of them is wrong; demote it to
         * `outline`.
         */
        default:
          "bg-dharma-accent text-dharma-ink-inverse hover:bg-dharma-accent-hover",
        outline:
          "border border-dharma-border-strong bg-dharma-surface text-dharma-ink hover:bg-dharma-surface-hover",
        ghost: "text-dharma-ink hover:bg-dharma-surface-hover",
        secondary:
          "bg-dharma-surface-hover text-dharma-ink hover:bg-dharma-border",
        /**
         * Tint + dark text, not a saturated red fill with white text — the
         * spec's pairing rule applies to destructive actions too. It reads
         * quieter than the old solid fill, which is correct: a delete button
         * should be findable, not loud.
         */
        destructive:
          "border border-dharma-danger bg-dharma-danger-bg text-dharma-danger-text hover:bg-dharma-danger hover:text-dharma-ink-inverse",
        /**
         * Retained as an alias of `default` so existing call sites keep
         * compiling. Warm Paper has ONE accent, so there is no second
         * high-intent fill for this to point at.
         */
        accent:
          "bg-dharma-accent text-dharma-ink-inverse hover:bg-dharma-accent-hover",
        /**
         * Text-weight action for dense tables and card headers. Uses the
         * on-tint terracotta (7.08:1) rather than the accent base — this is
         * text, and it does not spend the screen's accent budget because
         * nothing is filled.
         */
        link: "text-dharma-accent-on-tint underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        xs: "h-7 rounded-dharma-sm px-2 text-micro",
        sm: "h-8 rounded-dharma-md px-3 text-data",
        lg: "h-11 rounded-dharma-md px-6 text-[0.9375rem]",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";

export { Button, buttonVariants };
