import * as React from "react";
import { cn } from "@/lib/utils";

// Padding steps down from the shadcn default (p-6 -> p-4) across the card
// family. At dashboard density that reclaims roughly a row of table data per
// card without the layout reading as cramped.
//
// `density="compact"` steps down again (p-4 -> p-3) for cards whose content is
// a single band rather than a stacked block — the framework status card, chip
// rows, anything where p-4 leaves the reader crossing empty space to get from
// the metric to its label. Comfortable stays the default so no existing call
// site changes shape.

const DENSITY_PADDING = {
  comfortable: { block: "p-4", stacked: "p-4 pt-0" },
  compact: { block: "p-3", stacked: "p-3 pt-0" },
} as const;

export type CardDensity = keyof typeof DENSITY_PADDING;

const CardDensityContext = React.createContext<CardDensity>("comfortable");

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: CardDensity;
  /**
   * `flat` is the system default and the only variant the spec permits by
   * itself — Warm Paper has no elevation scale and no shadow token; depth is
   * carried by the hairline border. `elevated` therefore raises contrast via a
   * stronger border rather than a box-shadow, which would violate the spec.
   */
  variant?: "flat" | "elevated";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, density = "comfortable", variant = "flat", ...props }, ref) => (
    <CardDensityContext.Provider value={density}>
      <div
        ref={ref}
        className={cn(
          "rounded-lg border bg-dharma-surface text-dharma-ink",
          variant === "elevated" ? "border-dharma-border-strong" : "border-dharma-border",
          className,
        )}
        {...props}
      />
    </CardDensityContext.Provider>
  ),
);

Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(CardDensityContext);
  return (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1", DENSITY_PADDING[density].block, className)}
      {...props}
    />
  );
});

CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-[0.9375rem] font-semibold leading-tight tracking-[-0.01em]", className)}
    {...props}
  />
));

CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-data text-dharma-ink-secondary", className)} {...props} />
));

CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(CardDensityContext);
  return (
    <div ref={ref} className={cn(DENSITY_PADDING[density].stacked, className)} {...props} />
  );
});

CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const density = React.useContext(CardDensityContext);
  return (
    <div
      ref={ref}
      className={cn("flex items-center", DENSITY_PADDING[density].stacked, className)}
      {...props}
    />
  );
});

CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter };
