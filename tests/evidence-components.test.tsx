/** @jest-environment jsdom */
jest.mock('@/lib/hooks/useEvidence', () => ({
  useEvidence: () => ({
    listQuery: () => ({ data: { items: [] }, isLoading: false }),
    deleteEvidenceMutation: { mutateAsync: jest.fn() }
  })
}));

import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { EvidenceList } from '@/components/evidence/EvidenceList';
import React from 'react';

describe('EvidenceList', () => {
  it('should render empty state when no evidence', () => {
    render(<EvidenceList controlId="test-123" />);
    expect(screen.getByText(/no evidence uploaded yet/i)).toBeInTheDocument();
  });
});
