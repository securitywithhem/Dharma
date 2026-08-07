/** @jest-environment jsdom */
/**
 * WAVE 7.3 — the policies list distinguishes loading, error and empty.
 *
 * Closes fullstack-audit-2026-08-06 §6 HIGH-2 and §4 HIGH-2. The page was:
 *
 *   policiesQuery.data?.map(...)
 *   policiesQuery.data?.length === 0 ? <Card>No policies yet</Card> : null
 *
 * While loading, `data` is undefined so BOTH branches render nothing and the
 * user sees a bare heading. On error, identical — an outage is indistinguishable
 * from "you have no policies", which for a compliance product is actively
 * misleading rather than merely unpolished.
 *
 * Every assertion here fails on the pre-fix page.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const listQuery = jest.fn();
const capabilitiesQuery = jest.fn();

jest.mock('@/lib/trpc', () => ({
  api: {
    policy: { list: { useQuery: () => listQuery() } },
    user: { capabilities: { useQuery: () => capabilitiesQuery() } },
  },
}));

jest.mock('next/link', () => {
  const Link = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

// eslint-disable-next-line import/first
import PoliciesPage from '@/app/dashboard/policies/page';

/** Query states, named as the component branches on them. */
const loading = { isPending: true, isSuccess: false, isError: false, data: undefined };
const failed = {
  isPending: false,
  isSuccess: false,
  isError: true,
  data: undefined,
  error: { message: 'Database unreachable' },
  refetch: jest.fn(),
};
const succeeded = (data: unknown[]) => ({
  isPending: false,
  isSuccess: true,
  isError: false,
  data,
});

const manager = { isSuccess: true, data: { policiesWrite: true } };
const viewer = { isSuccess: true, data: { policiesWrite: false } };

const samplePolicy = {
  id: 'pol_1',
  title: 'Access Control Policy',
  policyType: 'ACCESS_CONTROL',
  isPublished: false,
  version: 1,
  content: 'The body of the policy.',
  publishedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  capabilitiesQuery.mockReturnValue(manager);
});

describe('the three states are distinguishable (§6 HIGH-2)', () => {
  it('while loading, shows neither the empty state nor an error', () => {
    listQuery.mockReturnValue(loading);
    render(<PoliciesPage />);

    expect(screen.queryByText(/no policies yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    // And is not a bare heading: something stands in for the pending content.
    expect(document.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('on error, says so instead of rendering an empty list', () => {
    listQuery.mockReturnValue(failed);
    render(<PoliciesPage />);

    expect(screen.getByText(/failed to load policies/i)).toBeInTheDocument();
    expect(screen.getByText(/database unreachable/i)).toBeInTheDocument();
    // Critically: the user must NOT be told they have no policies.
    expect(screen.queryByText(/no policies yet/i)).not.toBeInTheDocument();
  });

  it('offers a retry on error', () => {
    listQuery.mockReturnValue(failed);
    render(<PoliciesPage />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('on a genuinely empty result, shows the empty state', () => {
    listQuery.mockReturnValue(succeeded([]));
    render(<PoliciesPage />);

    expect(screen.getByText(/no policies yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });
});

describe('the empty state and header offer a way forward (§4 HIGH-2)', () => {
  it('the empty state has a real CTA, not just prose naming a workflow', () => {
    listQuery.mockReturnValue(succeeded([]));
    render(<PoliciesPage />);

    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/dashboard/policies/new');
    expect(links.length).toBeGreaterThan(0);
  });

  it('the header offers New policy even when the list is populated', () => {
    listQuery.mockReturnValue(succeeded([samplePolicy]));
    render(<PoliciesPage />);

    const links = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/dashboard/policies/new');
    expect(links.length).toBeGreaterThan(0);
  });

  it('hides the create actions from a user who cannot write policies', () => {
    // Gated on the server-resolved capability, so the UI never offers an
    // action the API refuses.
    capabilitiesQuery.mockReturnValue(viewer);
    listQuery.mockReturnValue(succeeded([]));
    render(<PoliciesPage />);

    const links = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/dashboard/policies/new');
    expect(links).toHaveLength(0);
  });
});

describe('policy cards link to the detail route (§4 CRITICAL)', () => {
  it('each card is a link to its policy', () => {
    listQuery.mockReturnValue(succeeded([samplePolicy]));
    render(<PoliciesPage />);

    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/dashboard/policies/pol_1');

    expect(link).toBeDefined();
    expect(link).toHaveTextContent('Access Control Policy');
  });

  it('shows the draft/published state on the card', () => {
    listQuery.mockReturnValue(
      succeeded([samplePolicy, { ...samplePolicy, id: 'pol_2', isPublished: true }]),
    );
    render(<PoliciesPage />);

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
  });
});
