import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Dharma mark — a geometric reduction of the dharmachakra: an outer rim,
 * eight spokes, and a solid hub.
 *
 * Drawn in `currentColor` rather than a fixed fill so it inherits the text
 * colour of its container. That is what lets it survive both themes and a
 * white-label tenant overriding --primary at runtime without shipping a second
 * asset. Strokes are set on a 24-unit grid at 1.5 weight to stay legible at
 * the 20px favicon/sidebar size.
 */
export function DharmaMark({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Dharma"
      className={cn("shrink-0", className)}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9.25"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <circle
        cx="12"
        cy="12"
        r="5"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.45"
      />
      {/* Eight spokes, drawn between the hub and the rim. */}
      <g stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.75">
        <path d="M12 2.75V7" />
        <path d="M12 17v4.25" />
        <path d="M2.75 12H7" />
        <path d="M17 12h4.25" />
        <path d="M5.46 5.46 8.46 8.46" />
        <path d="M15.54 15.54l3 3" />
        <path d="M18.54 5.46l-3 3" />
        <path d="M8.46 15.54l-3 3" />
      </g>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
