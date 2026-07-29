"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SEVERITIES, type Severity } from "@/components/ui/status-badge";

/**
 * The Dharma Ring — the app's one signature element.
 *
 * Concentric arcs resolving out of an unresolved track: the visual argument
 * that compliance is scattered evidence settling into an ordered record. It is
 * deliberately rationed to three places — the readiness gauge, scan/processing
 * progress, and the app's primary loading state. Using it as general
 * decoration is what would make it stop meaning anything.
 */

export interface RingSegment {
  severity: Severity;
  /** Relative weight. Segments are normalised, so any unit works. */
  value: number;
}

export interface DharmaRingProps extends React.HTMLAttributes<HTMLDivElement> {
  segments: RingSegment[];
  size?: number;
  strokeWidth?: number;
  /**
   * Play the settle animation. Ignored when the user prefers reduced motion —
   * the ring then renders its final state directly.
   */
  animated?: boolean;
  /** Accessible description. Required: the ring is never decorative. */
  label: string;
  /** Rendered in the ring's centre (score number, spinner caption). */
  children?: React.ReactNode;
  /**
   * Denominator for the arcs. Defaults to the sum of `segments`, which is what
   * a severity mix wants (the ring is the whole population). Pass an explicit
   * total for a gauge, where the unfilled remainder is meaningful — a
   * readiness score of 62 must leave 38% of the ring as unresolved track
   * rather than filling it completely.
   */
  total?: number;
}

const SEVERITY_VAR: Record<Severity, string> = {
  NONE: "var(--severity-none)",
  LOW: "var(--severity-low)",
  MEDIUM: "var(--severity-medium)",
  HIGH: "var(--severity-high)",
  CRITICAL: "var(--severity-critical)",
};

/**
 * SSR-safe `prefers-reduced-motion`. useSyncExternalStore rather than
 * useEffect+useState so the first client render already reflects the media
 * query — with useState the animated ring would paint for a frame before being
 * corrected, which is precisely what a reduced-motion user asked not to see.
 */
export function usePrefersReducedMotion(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    // Server snapshot: assume reduced motion. Erring this way means the static
    // arc is what gets server-rendered, so no animation can flash before
    // hydration settles the real preference.
    () => true,
  );
}

export function DharmaRing({
  segments,
  size = 140,
  strokeWidth = 12,
  animated = true,
  label,
  children,
  total: totalProp,
  className,
  ...props
}: DharmaRingProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Severity order, not input order: the ring must read as an escalation sweep
  // (settled -> critical) regardless of the order the caller assembled its data.
  const ordered = React.useMemo(
    () =>
      [...segments]
        .filter((s) => s.value > 0)
        .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
    [segments],
  );

  const sum = ordered.reduce((acc, s) => acc + s.value, 0);
  // Guard the gauge case: a caller-supplied total smaller than the data would
  // overflow the arcs past 360deg and wrap back over themselves.
  const total = totalProp !== undefined ? Math.max(totalProp, sum) : sum;

  // Lay each arc end-to-end around the circle, tracking the running offset.
  let cursor = 0;
  const arcs = ordered.map((segment, i) => {
    const fraction = total > 0 ? segment.value / total : 0;
    const arc = { ...segment, fraction, offset: cursor, index: i };
    cursor += fraction;
    return arc;
  });

  // The inner hairline is the "concentric" half of the motif — without it this
  // is just a donut chart.
  const innerRadius = radius - strokeWidth * 1.15;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      data-dharma-ring=""
      data-animated={shouldAnimate ? "true" : "false"}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // -90deg so arcs start at 12 o'clock rather than 3 o'clock.
        className="-rotate-90 overflow-visible"
        role="img"
        aria-label={label}
      >
        {/* Unresolved track — what the record looks like before it settles. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-dharma-border"
        />

        {arcs.map((arc) => (
          <circle
            key={arc.severity}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            stroke={`hsl(${SEVERITY_VAR[arc.severity]})`}
            // dasharray = [visible arc, rest of circle]; dashoffset rotates it
            // into position. Negative offset advances clockwise.
            strokeDasharray={`${arc.fraction * circumference} ${circumference}`}
            strokeDashoffset={-arc.offset * circumference}
            style={
              shouldAnimate
                ? {
                    // Sequential fill by severity, then converge — each arc
                    // waits out the ones ranked below it.
                    animation: `dharma-ring-settle 600ms cubic-bezier(0.16, 1, 0.3, 1) both`,
                    animationDelay: `${arc.index * 90}ms`,
                  }
                : undefined
            }
          />
        ))}

        {innerRadius > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={innerRadius}
            fill="none"
            strokeWidth={1}
            className="stroke-border"
          />
        )}
      </svg>

      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
