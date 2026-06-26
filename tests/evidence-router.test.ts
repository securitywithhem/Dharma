import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PrismaClient, Role, EvidenceType } from '@prisma/client';
import { createCallerFactory } from '@/server/trpc';
import { appRouter } from '@/server/routers';

const prisma = new PrismaClient();
let organizationId: string;
let userId: string;
let controlId: string;

function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(appRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: uid,
        email: "test@example.com",
        name: "Test User",
        organizationId: orgId,
        role,
      },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()
    },
    isAuditor: false,
    auditorTokenExpiry: undefined
  });
}

describe('evidence router', () => {
  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Test Org ${Date.now()}` },
    });
    organizationId = org.id;

    const user = await prisma.user.create({
      data: {
        email: `user-${Date.now()}@test.com`,
        name: "Tester",
        role: Role.ADMIN,
        organizationId: org.id,
      },
    });
    userId = user.id;

    // Create a framework and control so the test can target an explicit requirement
    const framework = await prisma.framework.create({
      data: { name: 'Test Framework', organizationId }
    });
    const control = await prisma.control.create({
      data: { frameworkId: framework.id, title: 'Test Control', domain: 'Test Domain', description: 'Test Control Description' }
    });
    controlId = control.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('should generate an upload URL', async () => {
    const caller = createCaller(organizationId, userId);
    const result = await caller.evidence.getUploadUrl({
      fileName: 'screenshot.png',
      contentType: 'image/png',
      controlId
    });
    expect(result.uploadUrl).toContain('http');
    expect(result.filePath).toBeDefined();
  });

  it('should create evidence and return record', async () => {
    const caller = createCaller(organizationId, userId);
    
    // Create a specific control for this test
    const framework = await prisma.framework.create({
      data: { name: 'Specific Framework', organizationId }
    });
    const control = await prisma.control.create({
      data: { frameworkId: framework.id, title: 'Specific Control', domain: 'Specific Domain', description: 'Specific Control Description' }
    });

    const evidence = await caller.evidence.create({
      controlId: control.id,
      fileName: 'screenshot.png',
      filePath: 'abc123-screenshot.png',
      type: EvidenceType.SCREENSHOT,
    });

    expect(evidence.id).toBeDefined();
    expect(evidence.fileName).toBe('screenshot.png');
  });

  it('should list evidence by control', async () => {
    const caller = createCaller(organizationId, userId);
    const list = await caller.evidence.list({});
    expect(Array.isArray(list.items)).toBe(true);
  });
});
