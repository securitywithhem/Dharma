/** @jest-environment jsdom */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import userEvent from '@testing-library/user-event';

import { ProgressRing } from '@/components/ui/progress-ring';
import { EmptyState } from '@/components/ui/empty-state';
import { GapBadge, SeverityBadge } from '@/components/ui/severity-badge';
import { ActionItemRow } from '@/components/dashboard/ActionItemRow';
import { FrameworkStatusCard, FrameworkStatusGrid } from '@/components/dashboard/FrameworkStatusCard';
import { DomainGapHeatmap } from '@/components/dashboard/DomainGapHeatmap';

import type { DomainGap, FrameworkSeverity } from '@/lib/compliance/severity';

// jsdom implements neither matchMedia nor requestAnimationFrame timing in the
// way ProgressRing's mount transition needs. Reduced-motion is reported as
// "off" so the animated path is the one under test.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
});

describe('ProgressRing', () => {
  it('exposes the value as a meter with an accessible name', () => {
    render(<ProgressRing value={64} severity="partial" label="ISO 27001 readiness" />);

    const meter = screen.getByRole('meter', { name: 'ISO 27001 readiness' });
    expect(meter).toHaveAttribute('aria-valuenow', '64');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps out-of-range values instead of drawing past the circumference', () => {
    render(<ProgressRing value={180} severity="complete" label="over" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
  });

  it('renders the percentage inside the ring', () => {
    render(<ProgressRing value={7} severity="critical" label="low" />);
    expect(screen.getByRole('meter')).toHaveTextContent('7%');
  });
});

describe('SeverityBadge / GapBadge', () => {
  it.each<[FrameworkSeverity, string]>([
    ['critical', 'At risk'],
    ['partial', 'Needs work'],
    ['healthy', 'On track'],
    ['complete', 'Complete'],
  ])('always renders a text label for %s', (severity, label) => {
    // WCAG 1.4.1 — healthy and complete share the success hue, so the label is
    // the only thing separating them and must never be dropped.
    const { unmount } = render(<SeverityBadge severity={severity} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    unmount();
  });

  it.each<[DomainGap, string]>([
    ['HIGH', 'high gap'],
    ['MEDIUM', 'medium gap'],
    ['LOW', 'low gap'],
    ['NONE', 'on track'],
  ])('supports the %s gap variant', (gap, label) => {
    // All four exist even though an unpopulated org only ever renders HIGH —
    // the point of the redesign is that this list stops looking uniform once
    // real data lands, which has to be verifiable before then.
    const { unmount } = render(<GapBadge gap={gap} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    unmount();
  });
});

describe('EmptyState', () => {
  it('renders guidance and an actionable route, not just a status line', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No activity yet"
        description="Uploads will appear here."
        action={{ label: 'Upload evidence', href: '/dashboard/evidence' }}
      />,
    );

    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByText('Uploads will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Upload evidence/ })).toHaveAttribute(
      'href',
      '/dashboard/evidence',
    );
  });

  it('omits the CTA when no action is supplied', () => {
    render(<EmptyState icon={Inbox} title="Nothing" description="Nothing here." />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('ActionItemRow', () => {
  const item = {
    id: 'ctl_1',
    title: 'Access Control Policy',
    frameworkName: 'ISO 27001',
    domain: 'Access Control',
    status: 'NOT_STARTED',
    evidenceCount: 0,
  };

  it('links to the control and escalates a control with no evidence', () => {
    render(
      <ul>
        <ActionItemRow item={item} rank={1} />
      </ul>,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/controls/ctl_1');
    expect(screen.getByText('no evidence')).toBeInTheDocument();
    // The dead-end "No evidence yet" string is replaced by a real next step.
    expect(screen.getByText(/Add evidence/)).toBeInTheDocument();
  });

  it('does not escalate a control that already has evidence', () => {
    render(
      <ul>
        <ActionItemRow item={{ ...item, evidenceCount: 3 }} rank={2} />
      </ul>,
    );

    expect(screen.getByText('3 evidence')).toBeInTheDocument();
    expect(screen.getByText(/Review/)).toBeInTheDocument();
  });
});

describe('FrameworkStatusCard', () => {
  const base = {
    id: 'fw_1',
    name: 'ISO 27001',
    version: '2022',
    progress: 0,
    controlCount: 93,
    compliantCount: 0,
  };

  it('renders the version chip so near-duplicate frameworks are distinguishable', () => {
    // Mitigates the duplicate ISO 27001 seed rows — see the TODO(data) in the
    // component. It does not fix the underlying seed defect.
    render(<FrameworkStatusCard {...base} />);
    expect(screen.getByText('v2022')).toBeInTheDocument();
  });

  it('does not prefix a non-numeric version', () => {
    // SOC 2 seeds version "Type II"; "vType II" is nonsense.
    render(<FrameworkStatusCard {...base} name="SOC 2" version="Type II" />);
    expect(screen.getByText('Type II')).toBeInTheDocument();
    expect(screen.queryByText('vType II')).not.toBeInTheDocument();
  });

  it('derives severity when the server does not supply it', () => {
    render(<FrameworkStatusCard {...base} progress={88} compliantCount={82} />);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('prefers the server-supplied severity', () => {
    render(<FrameworkStatusCard {...base} progress={88} severity="critical" />);
    expect(screen.getByText('At risk')).toBeInTheDocument();
  });

  it('reports outstanding controls for this framework only', () => {
    // The previous card printed an ORGANISATION-WIDE critical-gap count inside
    // every framework card, so all six claimed the same number.
    render(<FrameworkStatusCard {...base} compliantCount={20} />);
    expect(screen.getByText(/20 of 93 controls/)).toBeInTheDocument();
    expect(screen.getByText(/73 outstanding/)).toBeInTheDocument();
  });

  it('orders the grid worst-first', () => {
    render(
      <FrameworkStatusGrid
        frameworks={[
          { ...base, id: 'a', name: 'Healthy FW', progress: 90 },
          { ...base, id: 'b', name: 'Broken FW', progress: 5 },
          { ...base, id: 'c', name: 'Middling FW', progress: 60 },
        ]}
      />,
    );

    const names = screen.getAllByRole('link').map((el) => el.textContent);
    expect(names[0]).toContain('Broken FW');
    expect(names[2]).toContain('Healthy FW');
  });

  it('invites the user to act when no frameworks are tracked', () => {
    render(<FrameworkStatusGrid frameworks={[]} />);
    expect(screen.getByText('No frameworks tracked yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse frameworks/ })).toBeInTheDocument();
  });
});

describe('DomainGapHeatmap', () => {
  const domains = Array.from({ length: 12 }, (_, i) => ({
    name: `Domain ${i + 1}`,
    controlCount: 10,
    compliantCount: i,
    evidenceCount: 0,
    policyCount: 0,
    completionPercentage: i * 8,
    gap: 'HIGH' as DomainGap,
  }));

  it('collapses to the top five worst domains', () => {
    render(<DomainGapHeatmap domains={domains} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Domain 1')).toBeInTheDocument();
    expect(screen.queryByText('Domain 12')).not.toBeInTheDocument();
  });

  it('expands and re-collapses on demand without a new query', async () => {
    const user = userEvent.setup();
    render(<DomainGapHeatmap domains={domains} />);

    const toggle = screen.getByRole('button', { name: 'Show all 12 domains' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(12);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Show top 5 only' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
  });

  it('offers no toggle when everything already fits', () => {
    render(<DomainGapHeatmap domains={domains.slice(0, 4)} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('guides the user when there are no domains at all', () => {
    render(<DomainGapHeatmap domains={[]} />);
    expect(screen.getByText('No domains scored yet')).toBeInTheDocument();
  });
});
