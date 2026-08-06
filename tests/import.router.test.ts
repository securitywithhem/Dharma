/**
 * WAVE 5.2 — import router: organization context and audit coverage.
 *
 * Closes fullstack-audit-2026-08-06 BE-5 (zero audit entries on a router whose
 * two mutations move a third-party control set into and out of a tenant's
 * compliance programme) and BE-6 (bare protectedProcedure, so
 * enforceOrganizationContext never ran).
 *
 * The previous version of this suite passed a context with no prisma client at
 * all and asserted only that the service was called. It could not have caught
 * either finding.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient, Role } from '@prisma/client';
import { createTRPCRouter, createCallerFactory } from '@/server/trpc';
import { ImportService } from '@/server/services/import';
import { closeSessionIdentityRedis } from '@/server/lib/sessionIdentity';
import { seedRoleUser } from './fixtures/seedRoleUser';

jest.mock('@/server/services/import', () => ({
  ImportService: {
    importFramework: jest.fn(),
    unimportFramework: jest.fn().mockResolvedValue({ success: true }),
  },
}));

// eslint-disable-next-line import/first
import { importRouter } from '@/server/routers/import';

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ import: importRouter });

function callerFor(user: { id: string; organizationId: string }) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: user.id,
        email: 'import@test.dharma',
        name: 'Import Test',
        organizationId: user.organizationId,
        role: Role.ADMIN,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;
let user: { id: string; organizationId: string };

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `import-${Date.now()}` } })).id;
  user = await seedRoleUser(prisma, orgId, Role.ADMIN, 'import');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe('Import Router', () => {
  it('calls ImportService.importFramework via tRPC', async () => {
    const framework = await prisma.framework.create({
      data: { organizationId: orgId, name: `Imported ${Date.now()}` },
    });
    (ImportService.importFramework as jest.Mock).mockResolvedValue({
      framework,
      importedItem: { id: 'imported-1' },
      controlCount: 3,
    });

    const result = await callerFor(user).import.importFramework({
      marketplaceItemId: 'test-marketplace-item-id',
    });

    expect(result.framework.id).toBe(framework.id);
    expect(ImportService.importFramework).toHaveBeenCalledWith({
      organizationId: orgId,
      userId: user.id,
      marketplaceItemId: 'test-marketplace-item-id',
      frameworkNameOverride: undefined,
    });
  });

  it('writes a FRAMEWORK_IMPORTED audit entry (BE-5)', async () => {
    const framework = await prisma.framework.create({
      data: { organizationId: orgId, name: `Audited ${Date.now()}` },
    });
    (ImportService.importFramework as jest.Mock).mockResolvedValue({
      framework,
      importedItem: { id: 'imported-2' },
      controlCount: 7,
    });

    await callerFor(user).import.importFramework({ marketplaceItemId: 'mkt-audit' });

    const entry = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'FRAMEWORK_IMPORTED', entityId: framework.id },
    });

    expect(entry).not.toBeNull();
    expect(entry?.changes).toMatchObject({ controlCount: 7, marketplaceItemId: 'mkt-audit' });
  });

  it('writes a FRAMEWORK_UNIMPORTED audit entry naming the item (BE-5)', async () => {
    const imported = await prisma.importedItem.create({
      data: {
        organizationId: orgId,
        itemType: 'FRAMEWORK',
        itemName: 'Withdrawn Control Set',
        itemVersion: '1.0.0',
      },
    });

    await callerFor(user).import.unimportFramework({ importedItemId: imported.id });

    const entry = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'FRAMEWORK_UNIMPORTED', entityId: imported.id },
    });

    expect(entry).not.toBeNull();
    // Captured before the delete — the whole point is that the entry can still
    // name what left the tenant.
    expect(entry?.changes).toMatchObject({ itemName: 'Withdrawn Control Set' });
  });

  it('refuses a session with no organization context (BE-6)', async () => {
    // Previously this reached the resolver with organizationId "" and produced
    // a Prisma 500 on an empty FK rather than a clean UNAUTHORIZED.
    await expect(
      callerFor({ id: user.id, organizationId: '' }).import.importFramework({
        marketplaceItemId: 'whatever',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
