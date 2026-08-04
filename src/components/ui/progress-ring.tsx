'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

import type { FrameworkSeverity } from '@/lib/compliance/severity';

/**
 * Readiness ring — the dashboard's signature element.
 *
 * Replaces the percentage-plus-detached-bar pairing on the framework card. The
 * two used to sit at opposite corners with dead space between them; folding the
 * number inside the arc is simultaneously the layout fix and the brand device.
 *
 * Design constraints from 0_DESIGN_SYSTEM.md, all load-bearing:
 *
 *  - `strokeLinecap="butt"`. A rounded cap reads as a fitness tracker. A
 *    compliance console reads as a record.
 *  - Track and arc are token colours only. The arc uses the `-base` role value,
 *    which the spec permits for non-text marks (dots, chart series, progress
 *    fills, rules) — never for label text.
 *  - Motion is capped at --dharma-motion-base (150ms) and runs once on mount.
 *    Under prefers-reduced-motion the token collapses to 1ms globally AND the
 *    hook below skips straight to the final offset, so there is no flash of an
 *    empty ring for readers who asked for no motion.
 *
 * The centre slot is sized to accept a trend delta glyph later without a
 * relayout — see Dharma-Knowledge-OS/docs/design/dashboard-redesign-tokens.md § 6 for why the trend
 * data itself is not built yet.
 */

const ARC_STROKE: Record<FrameworkSeverity, string> = {
  // Muted border tone: an unpopulated framework has no readiness to signal.
  unconfigured: 'stroke-dharma-border-strong',
  critical: 'stroke-dharma-danger',
  partial: 'stroke-dharma-warning',
  healthy: 'stroke-dharma-success',
  complete: 'stroke-dharma-success',
};

export interface ProgressRingProps {
  /** 0–100. Clamped; callers pass the same rounded integer they render. */
  value: number;
  severity: FrameworkSeverity;
  /** Outer diameter in px. */
  size?: number;
  strokeWidth?: number;
  /** Accessible name, e.g. "ISO 27001 readiness". */
  label: string;
  className?: string;
}

function usePrefersReducedMotion(): boolean {
  // Defaults to `true` so the first server/hydration pass renders the ring at
  // its final value. Animating *into* view is a progressive enhancement; the
  // reverse default would show every reduced-motion user an empty ring.
  const [reduced, setReduced] = React.useState(true);

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function ProgressRing({
  value,
  severity,
  size = 44,
  strokeWidth = 5,
  label,
  className,
}: ProgressRingProps) {
  const pct = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100);

  const reducedMotion = usePrefersReducedMotion();
  const [filled, setFilled] = React.useState(false);

  React.useEffect(() => {
    if (reducedMotion) {
      setFilled(true);
      return;
    }
    // One frame at zero, then transition to value — without the deferral the
    // browser coalesces both states and no animation runs at all.
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, pct]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (filled ? pct : 0) / 100);

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* Track. Decorative — carries no value. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-dharma-surface-hover"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            ARC_STROKE[severity],
            'transition-[stroke-dashoffset] duration-dharma-base ease-dharma',
          )}
          // Start the arc at 12 o'clock and run clockwise, the direction a
          // reader expects a gauge to fill.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <span
        data-numeric
        className="absolute inset-0 flex items-center justify-center font-display text-[0.9375rem] font-semibold tabular-nums leading-none text-dharma-ink"
        aria-hidden
      >
        {pct}
        <span className="text-[0.6875rem] font-medium">%</span>
      </span>
    </div>
  );
}
