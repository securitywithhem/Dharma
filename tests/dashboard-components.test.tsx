/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { OverallReadinessScore } from '@/components/dashboard/OverallReadinessScore';
import React from 'react';

describe('OverallReadinessScore', () => {
  it('should render score and details', () => {
    render(
      <OverallReadinessScore
        score={75}
        totalControls={20}
        compliantControls={15}
      />
    );

    // Re-pointed at the redesigned component: the headline is now the score
    // itself with the counts demoted to a side <dl>, replacing the old
    // "15 of 20 controls compliant" prose.
    expect(screen.getByLabelText('Overall readiness')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();

    const compliant = screen.getByText('Compliant').closest('div');
    expect(compliant).toHaveTextContent('15');
    const outstanding = screen.getByText('Outstanding').closest('div');
    expect(outstanding).toHaveTextContent('5');
    const total = screen.getByText('Total').closest('div');
    expect(total).toHaveTextContent('20');
  });

  it('exposes the score as a meter for assistive tech', () => {
    render(
      <OverallReadinessScore score={75} totalControls={20} compliantControls={15} />
    );
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '75');
  });

  it('never reports negative outstanding controls', () => {
    // compliant > total is bad data, but it must not render "-5".
    render(
      <OverallReadinessScore score={100} totalControls={10} compliantControls={15} />
    );
    expect(screen.getByText('Outstanding').closest('div')).toHaveTextContent('0');
  });
});
