import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  GAP_LABEL,
  GAP_ROLE,
  SEVERITY_LABEL,
  SEVERITY_ROLE,
  type DomainGap,
  type FrameworkSeverity,
} from '@/lib/compliance/severity';
import { cn } from '@/lib/utils';

/**
 * Labelled severity chip.
 *
 * Deliberately a thin wrapper over `Badge` rather than its own `cva` block.
 * Badge already encodes the Warm Paper pairing rule ({role}-bg + {role}-text)
 * and the warning-size accessibility deviation documented in badge.tsx; a
 * parallel variant table here would silently drift from those and reintroduce
 * the sub-AA chips the last migration removed.
 *
 * The label is always rendered. Severity is never encoded by hue alone
 * (WCAG 1.4.1) — and `healthy` / `complete` share the success role, so for
 * those two the text is the only thing distinguishing them.
 */

export interface SeverityBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  severity: FrameworkSeverity;
  /** Show a role-coloured dot before the label. */
  withDot?: boolean;
}

const DOT_FILL: Record<FrameworkSeverity, string> = {
  unconfigured: 'bg-dharma-border-strong',
  critical: 'bg-dharma-danger',
  partial: 'bg-dharma-warning',
  healthy: 'bg-dharma-success',
  complete: 'bg-dharma-success',
};

export function SeverityBadge({
  severity,
  withDot = false,
  className,
  ...props
}: SeverityBadgeProps) {
  return (
    <Badge variant={SEVERITY_ROLE[severity]} className={className} {...props}>
      {withDot && (
        <span className={cn('h-1.5 w-1.5 rounded-full', DOT_FILL[severity])} aria-hidden />
      )}
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

export interface GapBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  gap: DomainGap;
}

/**
 * Domain coverage chip: high / medium / low gap, or "on track".
 *
 * All four variants exist and are exercised by the component tests even though
 * an unpopulated organisation currently renders only `HIGH` — the point of the
 * redesign is that this list stops looking uniform the moment real data lands,
 * and that behaviour needs to be verifiable before then.
 */
export function GapBadge({ gap, className, ...props }: GapBadgeProps) {
  return (
    <Badge variant={GAP_ROLE[gap]} className={className} {...props}>
      {GAP_LABEL[gap]}
    </Badge>
  );
}
