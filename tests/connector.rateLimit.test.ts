process.env.CONNECTOR_ENCRYPTION_KEY =
  process.env.CONNECTOR_ENCRYPTION_KEY ??
  "d41829a3f639e0b691ca7ab133b091d0af70733eb2b1a9ff0a7ac66d44f84b7";

import { describe, it, expect, afterAll } from "@jest/globals";
import { PrismaClient, Role, ConnectorType, ConnectorStatus } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { TRPCError } from "@trpc/server";

// Part 3 security review (4.7): connector.testConnection and
// connector.precheckConnection must be rate-limited per org, same as
// webhook.testDeliver (see webhook.router.test.ts). Mocks the connector
// registry so this suite doesn't attempt any real network call.
jest.mock("@/server/connectors/registry", () => ({
  getConnectorAdapter: jest.fn(() => ({
    testConnection: jest.fn().mockResolvedValue(true),
    listAvailableEvidenceTypes: jest.fn(() => []),
    collectEvidence: jest.fn(),
  })),
}));

jest.mock("@/server/queue/connectorQueue", () => ({
  removeRepeatableJob: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first
import { connectorRouter } from "@/server/routers/connector";
// eslint-disable-next-line import/first
import { encryptConnectorConfig } from "@/server/lib/crypto/connectorVault";

const testRouter = createTRPCRouter({ connector: connectorRouter });
const prisma = new PrismaClient();

function createCaller(orgId: string, uid: string, role: Role) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: uid, email: "test@example.com", name: "Test User", organizationId: orgId, role },
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

describe("connector rate limiting", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rate-limits precheckConnection beyond the per-minute cap", async () => {
    const org = await prisma.organization.create({ data: { name: `RateLimitPrecheck-${Date.now()}` } });
    const user = await prisma.user.create({
      data: { email: `rl-precheck-${Date.now()}@test.com`, name: "u", role: Role.ADMIN, organizationId: org.id },
    });
    const caller = createCaller(org.id, user.id, Role.ADMIN);

    for (let i = 0; i < 10; i++) {
      await caller.connector.precheckConnection({ type: ConnectorType.AWS, config: {} });
    }

    await expect(
      caller.connector.precheckConnection({ type: ConnectorType.AWS, config: {} }),
    ).rejects.toThrow(TRPCError);

    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  it("rate-limits testConnection beyond the per-minute cap", async () => {
    const org = await prisma.organization.create({ data: { name: `RateLimitTest-${Date.now()}` } });
    const user = await prisma.user.create({
      data: { email: `rl-test-${Date.now()}@test.com`, name: "u", role: Role.ADMIN, organizationId: org.id },
    });
    const connector = await prisma.connector.create({
      data: {
        organizationId: org.id,
        type: ConnectorType.AWS,
        name: "AWS",
        config: encryptConnectorConfig({ roleArn: "arn:aws:iam::123:role/x", externalId: "ext" }),
        status: ConnectorStatus.CONNECTED,
      },
    });
    const caller = createCaller(org.id, user.id, Role.ADMIN);

    for (let i = 0; i < 10; i++) {
      await caller.connector.testConnection({ id: connector.id });
    }

    await expect(caller.connector.testConnection({ id: connector.id })).rejects.toThrow(TRPCError);

    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
  });
});
