/**
 * @jest-environment jsdom
 */
import { describe, it, expect } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectorType } from '@prisma/client';
import { EvidenceMappingBoard } from '@/components/connectors/EvidenceMappingBoard';

// Mock the tRPC hooks
jest.mock('@/lib/trpc', () => ({
  api: {
    connector: {
      listAvailableEvidenceTypes: {
        useQuery: jest.fn(() => ({
          data: [
            { id: 'aws_cloudtrail_enabled', name: 'CloudTrail Enabled' },
            { id: 'aws_iam_mfa_enforced', name: 'IAM MFA Enforced' },
          ],
          isLoading: false,
        })),
      },
    },
    evidenceMapping: {
      listByConnector: {
        useQuery: jest.fn((connectorId: string) => ({
          data: [],
          isLoading: false,
        })),
      },
      create: {
        useMutation: jest.fn(() => ({
          mutateAsync: jest.fn().mockResolvedValue({ id: 'mapping-123' }),
          isPending: false,
        })),
      },
      update: {
        useMutation: jest.fn(() => ({
          mutateAsync: jest.fn().mockResolvedValue({ id: 'mapping-123', schedule: '0 3 * * *' }),
          isPending: false,
        })),
      },
      delete: {
        useMutation: jest.fn(() => ({
          mutateAsync: jest.fn().mockResolvedValue(undefined),
          isPending: false,
        })),
      },
      triggerNow: {
        useMutation: jest.fn(() => ({
          mutateAsync: jest.fn().mockResolvedValue({ jobId: 'job-123' }),
          isPending: false,
        })),
      },
    },
    useUtils: jest.fn(() => ({
      evidenceMapping: {
        listByConnector: { invalidate: jest.fn() },
        listByControl: { invalidate: jest.fn() },
      },
    })),
  },
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

describe('EvidenceMappingBoard', () => {
  it('renders available evidence types', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EvidenceMappingBoard
          connectorId="connector-123"
          connectorType={ConnectorType.AWS}
          connectorName="Test AWS Connector"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('CloudTrail Enabled')).toBeInTheDocument();
      expect(screen.getByText('IAM MFA Enforced')).toBeInTheDocument();
    });
  });

  it('renders available evidence types section', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EvidenceMappingBoard
          connectorId="connector-123"
          connectorType={ConnectorType.AWS}
          connectorName="Test AWS Connector"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Available Evidence Types')).toBeInTheDocument();
    });
  });

  it('renders mappings section', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EvidenceMappingBoard
          connectorId="connector-123"
          connectorType={ConnectorType.AWS}
          connectorName="Test AWS Connector"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Mappings')).toBeInTheDocument();
    });
  });

  it('renders collect now button placeholder text', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EvidenceMappingBoard
          connectorId="connector-123"
          connectorType={ConnectorType.AWS}
          connectorName="Test AWS Connector"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Drag evidence types here/)).toBeInTheDocument();
    });
  });
});
