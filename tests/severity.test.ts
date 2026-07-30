import {
  GAP_LABEL,
  GAP_ROLE,
  SEVERITY_LABEL,
  SEVERITY_ROLE,
  SEVERITY_THRESHOLDS,
  getFrameworkSeverity,
  getFrameworkSeverityFromCounts,
  severityNeedsAttention,
} from '@/lib/compliance/severity';

describe('getFrameworkSeverity', () => {
  it('bands each range', () => {
    expect(getFrameworkSeverity(0)).toBe('critical');
    expect(getFrameworkSeverity(49)).toBe('critical');
    expect(getFrameworkSeverity(50)).toBe('partial');
    expect(getFrameworkSeverity(79)).toBe('partial');
    expect(getFrameworkSeverity(80)).toBe('healthy');
    expect(getFrameworkSeverity(99)).toBe('healthy');
    expect(getFrameworkSeverity(100)).toBe('complete');
  });

  it('treats thresholds as inclusive lower bounds', () => {
    expect(getFrameworkSeverity(SEVERITY_THRESHOLDS.partial)).toBe('partial');
    expect(getFrameworkSeverity(SEVERITY_THRESHOLDS.healthy)).toBe('healthy');
    expect(getFrameworkSeverity(SEVERITY_THRESHOLDS.complete)).toBe('complete');
  });

  it('clamps out-of-range input rather than throwing', () => {
    // A dashboard must degrade to a rendered card, never to an error boundary.
    expect(getFrameworkSeverity(-20)).toBe('critical');
    expect(getFrameworkSeverity(140)).toBe('complete');
  });

  it('treats non-finite input as critical', () => {
    expect(getFrameworkSeverity(Number.NaN)).toBe('critical');
    expect(getFrameworkSeverity(Number.POSITIVE_INFINITY)).toBe('critical');
  });
});

describe('getFrameworkSeverityFromCounts', () => {
  it('agrees with the percentage form for the same ratio', () => {
    // The server bands from counts, the client from the rounded percentage.
    // These must never disagree — that divergence is what this module replaced.
    const cases: Array<[number, number]> = [
      [0, 93],
      [46, 93],
      [47, 93],
      [75, 93],
      [92, 93],
      [93, 93],
      [1, 3],
      [2, 3],
    ];

    for (const [done, total] of cases) {
      expect(getFrameworkSeverityFromCounts(done, total)).toBe(
        getFrameworkSeverity(Math.round((done / total) * 100)),
      );
    }
  });

  it('reports an empty framework as critical, not complete', () => {
    // 0/0 is not "fully compliant" — reporting 100% ready for an unpopulated
    // framework in front of an auditor is the worst failure mode here.
    expect(getFrameworkSeverityFromCounts(0, 0)).toBe('critical');
  });

  it('handles a fully compliant framework', () => {
    expect(getFrameworkSeverityFromCounts(93, 93)).toBe('complete');
  });
});

describe('severity presentation maps', () => {
  it('labels every band, so severity is never hue-only', () => {
    // WCAG 1.4.1 — healthy and complete share the success role, so their
    // labels are load-bearing and must never be dropped.
    for (const band of ['critical', 'partial', 'healthy', 'complete'] as const) {
      expect(SEVERITY_LABEL[band]).toBeTruthy();
      expect(SEVERITY_ROLE[band]).toBeTruthy();
    }
    expect(SEVERITY_ROLE.healthy).toBe(SEVERITY_ROLE.complete);
    expect(SEVERITY_LABEL.healthy).not.toBe(SEVERITY_LABEL.complete);
  });

  it('flags only the bands that need attention', () => {
    expect(severityNeedsAttention('critical')).toBe(true);
    expect(severityNeedsAttention('partial')).toBe(true);
    expect(severityNeedsAttention('healthy')).toBe(false);
    expect(severityNeedsAttention('complete')).toBe(false);
  });

  it('maps every domain gap level', () => {
    for (const gap of ['HIGH', 'MEDIUM', 'LOW', 'NONE'] as const) {
      expect(GAP_LABEL[gap]).toBeTruthy();
      expect(GAP_ROLE[gap]).toBeTruthy();
    }
    expect(GAP_LABEL.NONE).toBe('on track');
  });
});
