import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Transitions are scoped to the properties that actually change — the old
  // global `* { transition-colors }` in globals.css made every element in the
  // tree transition, which is both a paint cost and a visible lag on theme
  // switch. `active:translate-y-px` gives a physical press without motion libs.
  [
    "inline-flex items-center justify-center whitespace-nowrap gap-2",
    "rounded-md text-sm font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95",
        outline:
          "border border-border bg-card text-foreground shadow-xs hover:bg-secondary hover:border-border",
        ghost: "text-foreground hover:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        /** Haldi — reserved for the single highest-intent action on a view. */
        accent:
          "bg-accent text-accent-foreground shadow-xs hover:bg-accent/90",
        /** Text-weight action for use inside dense tables and card headers. */
        link: "text-primary underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        xs: "h-7 rounded-sm px-2 text-micro",
        sm: "h-8 rounded-md px-3 text-data",
        lg: "h-11 rounded-md px-6 text-[0.9375rem]",
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
