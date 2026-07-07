/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MarketplaceGrid } from '@/components/marketplace/MarketplaceGrid';
import { MarketplaceSidebar } from '@/components/marketplace/MarketplaceSidebar';

// Mock Next.js router and Link
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  usePathname: () => '/',
  useParams: () => ({ id: '1' }),
}));

jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

describe('Marketplace UI Components', () => {
  const mockItems = [
    {
      id: '1',
      name: 'SOC2 Framework',
      description: 'A SOC2 framework',
      shortDescription: 'SOC2 framework',
      category: 'SOC2',
      type: 'FRAMEWORK' as const,
      price: 0,
      ratings: 4.5,
      reviewCount: 10,
      downloads: 100,
      author: { name: 'Dharma' },
      tags: [],
    },
  ];

  it('should render marketplace grid', () => {
    render(<MarketplaceGrid items={mockItems} />);
    expect(screen.getByText('SOC2 Framework')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('should handle filter changes', () => {
    const handleChange = jest.fn();
    const { getByRole, getByText } = render(
      <MarketplaceSidebar
        categories={[{ name: 'SOC2', count: 5 }]}
        currentFilters={{
          category: '',
          type: '',
          sortBy: 'recent',
          page: 1,
        }}
        onFilterChange={handleChange}
      />
    );

    const button = getByText('SOC2');
    fireEvent.click(button);
    expect(handleChange).toHaveBeenCalledWith({
      category: 'SOC2',
      type: '',
      sortBy: 'recent',
      page: 1,
    });
  });
});
