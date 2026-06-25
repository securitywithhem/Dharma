import { aggregateReportData } from '@/lib/services/reportGenerator';
import { prisma } from '@/server/db';

jest.mock('@/server/audit-log', () => ({
  verifyAuditChain: jest.fn().mockReturnValue({ ok: true, brokenAtId: null, reason: null }),
}));

jest.mock('@/server/db', () => ({
  prisma: {
    organization: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'org_test_123',
        name: 'Test Org',
        createdAt: new Date(),
      }),
    },
    framework: {
      findMany: jest.fn().mockResolvedValue([
        {
          name: 'SOC 2 Type II',
          version: '2017',
          organizationId: 'org_test_123',
          controls: [
            {
              id: 'c1',
              title: 'Access Control',
              description: 'Logical access controls',
              domain: 'Security',
              status: 'COMPLIANT',
              evidence: [
                { fileName: 'access-review.pdf', type: 'PDF', collectedAt: new Date() }
              ]
            },
            {
              id: 'c2',
              title: 'Encryption',
              description: 'Data at rest encryption',
              domain: 'Security',
              status: 'IN_PROGRESS',
              evidence: []
            }
          ]
        }
      ]),
    },
    policy: {
      findMany: jest.fn().mockResolvedValue([
        { title: 'Information Security Policy', type: 'SECURITY', version: 1, isPublished: true, updatedAt: new Date() }
      ]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([
        { action: 'LOGIN', entity: 'User', timestamp: new Date(), userId: 'u1', previousHash: null }
      ]),
    }
  }
}));

describe('Report Generator', () => {
  it('should aggregate all organization data correctly', async () => {
    const reportData = await aggregateReportData('org_test_123');
    
    expect(reportData.organization.id).toBe('org_test_123');
    expect(reportData.frameworks).toBeDefined();
    expect(reportData.frameworks.length).toBe(1);
    expect(reportData.frameworks[0].progressPercentage).toBe(50); // 1 compliant out of 2
    expect(reportData.complianceScore).toBe(50);
    expect(reportData.verificationStatus).toBe('VALID');
  });
});
