import { appRouter } from '@/server/routers';
import { prisma } from '@/server/db';
import { createInnerTRPCContext } from '@/server/trpc';

jest.mock('@/server/db', () => ({
  prisma: {
    framework: {
      findMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  },
}));

describe('dashboard.getStats', () => {
  it('should return dashboard stats', async () => {
    // Mock the session
    const mockSession = {
      user: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        organizationId: 'org-1',
        role: 'ADMIN' as any,
      },
      expires: new Date().toISOString(),
    };

    const ctx = await createInnerTRPCContext({
      headers: new Headers(),
      session: mockSession,
    });

    const caller = appRouter.createCaller(ctx);

    // Mock Prisma responses
    jest.mocked(prisma.framework.findMany).mockResolvedValueOnce([
      {
        id: 'fw-1',
        name: 'Test Framework',
        version: '1.0',
        organizationId: 'org-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        controls: [
          {
            id: 'c-1',
            title: 'Control 1',
            domain: 'Domain A',
            status: 'COMPLIANT',
            evidence: [{ id: 'e-1' }],
          },
          {
            id: 'c-2',
            title: 'Control 2',
            domain: 'Domain A',
            status: 'IN_PROGRESS',
            evidence: [],
          },
        ],
      },
    ] as any);

    jest.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        id: 'log-1',
        action: 'EVIDENCE_UPLOAD',
        entity: 'Evidence',
        entityId: 'e-1',
        timestamp: new Date(),
        organizationId: 'org-1',
        userId: 'user-1',
        changes: null,
        previousHash: null,
        currentHash: 'hash-1',
        createdAt: new Date(),
        user: { name: 'Test User' },
      },
    ] as any);

    const stats = await caller.dashboard.getStats();

    expect(stats.overallScore).toBe(50); // 1 out of 2 compliant
    expect(stats.totalControls).toBe(2);
    expect(stats.compliantControls).toBe(1);
    expect(stats.inProgressControls).toBe(1);
    expect(stats.notStartedControls).toBe(0);

    expect(Array.isArray(stats.frameworks)).toBe(true);
    expect(stats.frameworks.length).toBe(1);
    expect(stats.frameworks[0].progress).toBe(50);

    expect(Array.isArray(stats.domains)).toBe(true);
    expect(stats.domains.length).toBe(1);
    expect(stats.domains[0].gap).toBe('MEDIUM'); // 50% compliant

    expect(Array.isArray(stats.recentActivity)).toBe(true);
    expect(stats.recentActivity.length).toBe(1);
  });
});
