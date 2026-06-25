import { onboardingRouter } from '@/server/routers/onboarding';
import { createInnerTRPCContext } from '@/server/trpc';
import { Role } from '@prisma/client';

// Mock the prisma context
const mockPrisma = {
  organization: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  framework: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  control: {
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
  },
};

describe('onboarding router', () => {
  let ctx: any;
  let caller: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create an authenticated context
    ctx = {
      prisma: mockPrisma as any,
      session: {
        user: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
          organizationId: 'org-1',
          role: Role.ADMIN,
        },
        expires: new Date().toISOString(),
      },
    };
    
    // Setup the caller using the test context
    caller = onboardingRouter.createCaller(ctx);
  });

  it('should get onboarding status', async () => {
    mockPrisma.organization.findUnique.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Org',
      frameworks: [{ id: 'fw-1' }],
    });

    const result = await caller.getOnboardingStatus();
    expect(result.isComplete).toBe(true);
    expect(result.organizationId).toBe('org-1');
  });

  it('should setup organization', async () => {
    mockPrisma.organization.update.mockResolvedValueOnce({
      id: 'org-1',
      name: 'New Test Corp',
    });

    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await caller.setupOrganization({
      organizationName: 'New Test Corp',
    });

    expect(result.success).toBe(true);
    expect(result.organizationId).toBe('org-1');
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { name: 'New Test Corp' },
    });
  });

  it('should select frameworks', async () => {
    mockPrisma.framework.findFirst.mockResolvedValueOnce(null);
    mockPrisma.framework.create.mockResolvedValueOnce({
      id: 'fw-1',
      name: 'Digital Personal Data Protection Act 2023',
    });
    mockPrisma.control.create.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await caller.selectFrameworks({
      frameworks: ['DPDP_ACT_2023'],
    });

    expect(result.success).toBe(true);
    expect(result.frameworks.length).toBe(1);
    expect(mockPrisma.framework.create).toHaveBeenCalled();
    // DPDP has 4 domains, so control.create should be called 4 times
    expect(mockPrisma.control.create).toHaveBeenCalledTimes(4);
  });
  
  it('should complete onboarding', async () => {
    mockPrisma.framework.findMany.mockResolvedValueOnce([
        { id: 'fw-1' }
    ]);
    mockPrisma.auditLog.create.mockResolvedValueOnce({});

    const result = await caller.completeOnboarding();
    
    expect(result.success).toBe(true);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
            data: expect.objectContaining({
                action: 'ONBOARDING_COMPLETED'
            })
        })
    );
  });
});
