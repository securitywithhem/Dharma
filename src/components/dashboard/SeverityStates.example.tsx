import React from 'react';
import { ProgressRing } from '@/components/ui/progress-ring';
import { GapBadge, SeverityBadge } from '@/components/ui/severity-badge';
import { FrameworkStatusCard } from '@/components/dashboard/FrameworkStatusCard';

import type { DomainGap, FrameworkSeverity } from '@/lib/compliance/severity';

/**
 * QA reference — every severity state side by side.
 *
 * Follows the repo's existing colocated-example convention
 * (see EvidenceUploadFlow.example.tsx); this project has no Storybook and no
 * /dev preview route, so a new one is not introduced here.
 *
 * The reason this exists: an unpopulated organisation renders `HIGH` gaps and
 * `critical` frameworks and nothing else, so the states that matter most once
 * real data lands are exactly the ones that never appear during development.
 * They are exercised by tests/dashboard-severity.test.tsx and are eyeballable
 * here.
 *
 * Not routed. Import it into a scratch page to view.
 */

const SEVERITIES: FrameworkSeverity[] = ['unconfigured', 'critical', 'partial', 'healthy', 'complete'];
const GAPS: DomainGap[] = ['HIGH', 'MEDIUM', 'LOW', 'NONE'];
const SAMPLE_PERCENT: Record<FrameworkSeverity, number> = {
  unconfigured: 0,
  critical: 12,
  partial: 64,
  healthy: 88,
  complete: 100,
};

export function SeverityStatesExample() {
  return (
    <div className="space-y-8 p-8">
      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-dharma-ink">Framework severity</h2>
        <div className="flex flex-wrap items-center gap-3">
          {SEVERITIES.map((severity) => (
            <SeverityBadge key={severity} severity={severity} withDot />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-dharma-ink">Domain gap</h2>
        <div className="flex flex-wrap items-center gap-3">
          {GAPS.map((gap) => (
            <GapBadge key={gap} gap={gap} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-dharma-ink">Readiness ring</h2>
        <div className="flex flex-wrap items-center gap-6">
          {SEVERITIES.map((severity) => (
            <ProgressRing
              key={severity}
              value={SAMPLE_PERCENT[severity]}
              severity={severity}
              label={`${severity} example`}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-dharma-ink">Status card</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SEVERITIES.map((severity) => (
            <FrameworkStatusCard
              key={severity}
              id={severity}
              name={`Example framework (${severity})`}
              version="2022"
              progress={SAMPLE_PERCENT[severity]}
              controlCount={100}
              compliantCount={SAMPLE_PERCENT[severity]}
              severity={severity}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
