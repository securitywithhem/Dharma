import { importRouter } from '@/server/routers/import';
import { prisma } from '@/server/db';
import { ImportService } from '@/server/services/import';

jest.mock('@/server/services/import', () => ({
  ImportService: {
    importFramework: jest.fn().mockResolvedValue({
      framework: { id: 'test-fw-id' },
    }),
  },
}));

describe('Import Router', () => {
  it('should call ImportService.importFramework via tRPC', async () => {
    const caller = importRouter.createCaller({
      session: {
        user: {
          id: 'test-user-id',
          organizationId: 'test-org-id',
        },
      } as any,
    } as any);

    const result = await caller.importFramework({
      marketplaceItemId: 'test-marketplace-item-id',
    });

    expect(result.framework.id).toBe('test-fw-id');
    expect(ImportService.importFramework).toHaveBeenCalledWith({
      organizationId: 'test-org-id',
      userId: 'test-user-id',
      marketplaceItemId: 'test-marketplace-item-id',
      frameworkNameOverride: undefined,
    });
  });
});
