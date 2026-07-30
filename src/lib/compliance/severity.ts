/**
 * Canonical readiness → severity banding for compliance surfaces.
 *
 * ONE implementation, imported by both the server (dashboardRouter.getStats)
 * and the client components that render the result. It is deliberately NOT
 * duplicated as a "client copy kept in agreement by test" — two implementations
 * that must be kept in sync is the defect, not the safeguard.
 *
 * Before this module existed the thresholds disagreed in production: the card
 * inlined in `app/dashboard/page.tsx` banded at 50/80 while the parallel
 * `components/dashboard/FrameworkProgressCards.tsx` banded at 60/80, so a
 * framework at 55% read "At risk" in one and "Needs work" in the other. Both
 * implementations were replaced by `FrameworkStatusCard`; the numbers below
 * are the reconciled set.
 *
 * See Dharma-Knowledge-OS/docs/design/dashboard-redesign-tokens.md § 7.
 */

/** Framework/control-set readiness bands. Ordered worst → best. */
export type FrameworkSeverity = 'critical' | 'partial' | 'healthy' | 'complete';

/** Domain coverage shortfall, as already emitted by dashboardRouter. */
export type DomainGap = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * Percentage boundaries, inclusive lower bound. `complete` is exactly 100 —
 * 99.6% rounds to 100 at the display layer but is not "complete", so callers
 * must pass the same rounded integer they render. getStats already rounds.
 */
export const SEVERITY_THRESHOLDS = {
  partial: 50,
  healthy: 80,
  complete: 100,
} as const;

/**
 * Band a readiness percentage.
 *
 * Out-of-range input is clamped rather than rejected: bad upstream data must
 * degrade to a rendered card, never to a thrown error on a dashboard.
 */
export function getFrameworkSeverity(percentComplete: number): FrameworkSeverity {
  if (!Number.isFinite(percentComplete)) return 'critical';

  const pct = Math.min(Math.max(percentComplete, 0), 100);

  if (pct >= SEVERITY_THRESHOLDS.complete) return 'complete';
  if (pct >= SEVERITY_THRESHOLDS.healthy) return 'healthy';
  if (pct >= SEVERITY_THRESHOLDS.partial) return 'partial';
  return 'critical';
}

/**
 * Band from raw counts. A framework with zero controls is `critical`, not
 * `complete`: an empty framework is unevidenced, and reporting 100% ready for
 * a framework nobody has populated is the single worst failure mode this
 * dashboard could have in front of an auditor.
 */
export function getFrameworkSeverityFromCounts(
  controlsComplete: number,
  controlsTotal: number,
): FrameworkSeverity {
  if (controlsTotal <= 0) return 'critical';
  return getFrameworkSeverity(Math.round((controlsComplete / controlsTotal) * 100));
}

/** Human label. Always rendered — severity is never encoded by hue alone (WCAG 1.4.1). */
export const SEVERITY_LABEL: Record<FrameworkSeverity, string> = {
  critical: 'At risk',
  partial: 'Needs work',
  healthy: 'On track',
  complete: 'Complete',
};

/**
 * Warm Paper semantic role per severity.
 *
 * `healthy` and `complete` intentionally share the success role. Four semantic
 * roles cannot encode four bands plus a neutral, and the adopted palette adds
 * no fifth hue — so these two are separated by their always-visible label, the
 * same load-bearing-label constraint accepted in 634c9ec for HIGH vs CRITICAL.
 */
export const SEVERITY_ROLE: Record<FrameworkSeverity, 'critical' | 'warning' | 'success'> = {
  critical: 'critical',
  partial: 'warning',
  healthy: 'success',
  complete: 'success',
};

/**
 * Whether a card should carry a coloured severity rule.
 *
 * Only true for bands that need attention. Painting a green rule on a healthy
 * card spends the reader's severity channel on "nothing is wrong here" — the
 * palette's stated intent is to sit quiet until something is actually wrong.
 */
export function severityNeedsAttention(severity: FrameworkSeverity): boolean {
  return severity === 'critical' || severity === 'partial';
}

/** Domain gap → badge label. `NONE` reads as an achievement, not an absence. */
export const GAP_LABEL: Record<DomainGap, string> = {
  HIGH: 'high gap',
  MEDIUM: 'medium gap',
  LOW: 'low gap',
  NONE: 'on track',
};

/** Domain gap → Warm Paper semantic role. */
export const GAP_ROLE: Record<DomainGap, 'critical' | 'warning' | 'secondary' | 'success'> = {
  HIGH: 'critical',
  MEDIUM: 'warning',
  LOW: 'secondary',
  NONE: 'success',
};
