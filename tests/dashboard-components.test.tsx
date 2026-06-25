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

    expect(screen.getByText(/compliance/i)).toBeInTheDocument();
    expect(screen.getByText(/15 of 20 controls compliant/i)).toBeInTheDocument();
    expect(screen.getByText(/5 controls need attention/i)).toBeInTheDocument();
  });
});
