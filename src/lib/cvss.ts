/**
 * CVSS Score Utilities
 *
 * Helpers for working with CVSS (Common Vulnerability Scoring System) scores
 * used throughout the vulnerability management system.
 */

/**
 * CVSS Severity bands and their thresholds
 *
 * Red (Critical): 7.0-10.0
 * Amber (Medium): 4.0-6.9
 * Green (Low): 0.0-3.9
 *
 * Color is never the only indicator — it's paired with icons and labels.
 */
export const CVSS_BANDS = {
  critical: {
    min: 7.0,
    max: 10.0,
    label: 'Critical',
    color: 'text-critical',
    bgColor: 'bg-critical/10',
    badgeVariant: 'destructive' as const,
  },
  medium: {
    min: 4.0,
    max: 6.9,
    label: 'Medium',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
    badgeVariant: 'warning' as const,
  },
  low: {
    min: 0.0,
    max: 3.9,
    label: 'Low',
    color: 'text-success',
    bgColor: 'bg-success/10',
    badgeVariant: 'secondary' as const,
  },
} as const;

/**
 * Get the severity band for a CVSS score
 *
 * @param cvss - CVSS score (0-10)
 * @returns Severity band object with styling and label
 */
export function getCVSSBand(cvss: number) {
  if (cvss >= CVSS_BANDS.critical.min) {
    return CVSS_BANDS.critical;
  }
  if (cvss >= CVSS_BANDS.medium.min) {
    return CVSS_BANDS.medium;
  }
  return CVSS_BANDS.low;
}

/**
 * Check if a CVSS score is in the critical range
 */
export function isCritical(cvss: number): boolean {
  return cvss >= CVSS_BANDS.critical.min;
}

/**
 * Check if a CVSS score is in the medium range
 */
export function isMedium(cvss: number): boolean {
  return cvss >= CVSS_BANDS.medium.min && cvss < CVSS_BANDS.critical.min;
}

/**
 * Check if a CVSS score is in the low range
 */
export function isLow(cvss: number): boolean {
  return cvss < CVSS_BANDS.medium.min;
}

/**
 * Format CVSS score for display (1-2 decimal places)
 */
export function formatCVSS(cvss: number): string {
  return cvss.toFixed(1);
}

/**
 * Calculate the urgency of a vulnerability based on CVSS and due date
 *
 * @param cvss - CVSS score
 * @param dueDate - ISO date string for remediation due date
 * @returns Urgency level: 'critical', 'high', 'medium', 'low'
 */
export function calculateUrgency(
  cvss: number,
  dueDate: string
): 'critical' | 'high' | 'medium' | 'low' {
  const today = new Date();
  const due = new Date(dueDate);
  const daysUntilDue = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // If overdue, always critical
  if (daysUntilDue < 0) {
    return 'critical';
  }

  // Critical CVSS + due within 7 days
  if (isCritical(cvss) && daysUntilDue <= 7) {
    return 'critical';
  }

  // Critical CVSS + due within 14 days
  if (isCritical(cvss) && daysUntilDue <= 14) {
    return 'high';
  }

  // Medium CVSS + due within 7 days
  if (isMedium(cvss) && daysUntilDue <= 7) {
    return 'high';
  }

  // Medium CVSS
  if (isMedium(cvss)) {
    return 'medium';
  }

  return 'low';
}
