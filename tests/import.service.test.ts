import { ImportService } from '@/server/services/import';
import { prisma } from '@/server/db';

jest.mock('@/server/services/entitlement', () => ({
  EntitlementService: jest.fn().mockImplementation(() => ({
    checkUsageLimit: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/server/db', () => ({
  prisma: {
    importedItem: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    marketplaceItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    framework: {
      create: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

describe('ImportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should import a framework successfully', async () => {
    // Mock no existing import
    (prisma.importedItem.findUnique as jest.Mock).mockResolvedValue(null);
    
    // Mock valid marketplace item
    (prisma.marketplaceItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1',
      type: 'FRAMEWORK',
      name: 'Test Framework',
      isPublic: true,
      metadata: {
        controls: [{ title: 'C1', domain: 'D1' }],
      },
      version: 1,
    });

    // Mock framework creation
    (prisma.framework.create as jest.Mock).mockResolvedValue({
      id: 'fw-1',
      controls: [{ id: 'c-1' }],
    });

    // Mock imported item creation
    (prisma.importedItem.create as jest.Mock).mockResolvedValue({
      id: 'import-1',
    });

    const result = await ImportService.importFramework({
      organizationId: 'org-1',
      marketplaceItemId: 'item-1',
    });

    expect(result.framework.id).toBe('fw-1');
    expect(result.controlCount).toBe(1);
    expect(prisma.framework.create).toHaveBeenCalled();
    expect(prisma.importedItem.create).toHaveBeenCalled();
    expect(prisma.marketplaceItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { downloads: { increment: 1 } },
      })
    );
  });

  it('should prevent duplicate imports', async () => {
    // Mock existing import
    (prisma.importedItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'import-1',
    });

    await expect(
      ImportService.importFramework({
        organizationId: 'org-1',
        marketplaceItemId: 'item-1',
      })
    ).rejects.toThrow('already imported');
  });
});
