/**
 * @jest-environment node
 *
 * tests/audit.test.ts
 *
 * Integration tests for:
 *  - SHA-256 hash computation
 *  - Audit log chain creation
 *  - Chain integrity verification
 *  - Tamper detection
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import {
  computeAuditHash,
  createAuditLog,
  verifyAuditChain,
} from "@/server/audit-log";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/dharma_test",
    },
  },
});

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

let organizationId: string;
let userId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `Audit Test Org — ${Date.now()}` },
  });
  organizationId = org.id;

  const user = await prisma.user.create({
    data: {
      email: `audit-${Date.now()}@dharma-test.internal`,
      name: "Audit Tester",
      role: Role.ADMIN,
      organizationId: org.id,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  // Clean up in dependency order
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } }).catch(() => undefined);
  await prisma.$disconnect();
});

// ------------------------------------------------------------------
// Helper: wipe logs between tests so chains are isolated
// ------------------------------------------------------------------

async function clearLogs() {
  await prisma.auditLog.deleteMany({ where: { organizationId } });
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------
// Unit tests: computeAuditHash
// ------------------------------------------------------------------

describe("computeAuditHash", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeAuditHash({
      organizationId: "org-1",
      userId: "user-1",
      action: "TEST",
      entity: "TestEntity",
      entityId: "entity-1",
      changes: null,
      timestamp: new Date("2024-01-01T00:00:00Z").toISOString(),
      previousHash: null,
    });

    expect(typeof hash).toBe("string");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("produces a different hash when any field changes", () => {
    const base = {
      organizationId: "org-1",
      userId: "user-1",
      action: "TEST",
      entity: "TestEntity",
      entityId: "entity-1",
      changes: null,
      timestamp: new Date("2024-01-01T00:00:00Z").toISOString(),
      previousHash: null,
    };

    const h1 = computeAuditHash(base);
    const h2 = computeAuditHash({ ...base, action: "CHANGED_ACTION" });
    const h3 = computeAuditHash({ ...base, previousHash: "someprevhash" });

    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });

  it("is deterministic for the same inputs", () => {
    const entry = {
      organizationId: "org-stable",
      userId: "user-stable",
      action: "DETERMINISTIC_TEST",
      entity: "Entity",
      entityId: "id-42",
      changes: { foo: "bar" },
      timestamp: "2025-06-15T12:00:00.000Z",
      previousHash: "abc123",
    };

    expect(computeAuditHash(entry)).toBe(computeAuditHash(entry));
  });
});

// ------------------------------------------------------------------
// Integration tests: createAuditLog
// ------------------------------------------------------------------

describe("createAuditLog — genesis entry", () => {
  beforeAll(clearLogs);

  it("creates a log with null previousHash for the first entry", async () => {
    const log = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "GENESIS",
      entity: "TestEntity",
      entityId: "entity-1",
      changes: null,
    });

    expect(log.id).toBeDefined();
    expect(log.previousHash).toBeNull();
    expect(log.currentHash).toHaveLength(64);
  });
});

describe("createAuditLog — chain linking", () => {
  beforeAll(clearLogs);

  it("links each entry to the previous entry's hash", async () => {
    const first = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ACTION_1",
      entity: "Entity",
      entityId: "e1",
      changes: null,
    });
    await sleep(10);

    const second = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ACTION_2",
      entity: "Entity",
      entityId: "e2",
      changes: null,
    });
    await sleep(10);

    const third = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ACTION_3",
      entity: "Entity",
      entityId: "e3",
      changes: null,
    });

    expect(second.previousHash).toBe(first.currentHash);
    expect(third.previousHash).toBe(second.currentHash);
  });
});

describe("createAuditLog — changes payload", () => {
  beforeAll(clearLogs);

  it("stores arbitrary JSON changes and includes them in the hash input", async () => {
    const changes = {
      fileName: "policy.pdf",
      type: "POLICY_DOC",
      controlId: "ctrl-123",
    };

    const log = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "EVIDENCE_UPLOADED",
      entity: "Evidence",
      entityId: "ev-001",
      changes,
    });

    expect(log.changes).toMatchObject(changes);
    // Verify the hash includes the changes (by re-computing it)
    const expected = computeAuditHash({
      organizationId: log.organizationId,
      userId: log.userId,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      changes: log.changes,
      timestamp: log.timestamp.toISOString(),
      previousHash: log.previousHash,
    });
    expect(expected).toBe(log.currentHash);
  });
});

// ------------------------------------------------------------------
// Integration tests: verifyAuditChain
// ------------------------------------------------------------------

describe("verifyAuditChain — intact chain", () => {
  beforeAll(clearLogs);

  it("returns ok=true for an empty chain", () => {
    const result = verifyAuditChain([]);
    expect(result.ok).toBe(true);
    expect(result.brokenAtId).toBeNull();
  });

  it("returns ok=true for a single-entry chain", async () => {
    await clearLogs();

    const log = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "SINGLE",
      entity: "Entity",
      entityId: "e1",
      changes: null,
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ timestamp: "asc" }],
    });

    const result = verifyAuditChain(logs);
    expect(result.ok).toBe(true);
    expect(result.brokenAtId).toBeNull();
  });

  it("returns ok=true for a multi-entry intact chain", async () => {
    await clearLogs();

    for (let i = 0; i < 5; i++) {
      await createAuditLog(prisma, {
        organizationId,
        userId,
        action: `ACTION_${i}`,
        entity: "Entity",
        entityId: `e${i}`,
        changes: { index: i },
      });
      await sleep(10);
    }

    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });

    expect(logs.length).toBe(5);
    const result = verifyAuditChain(logs);
    expect(result.ok).toBe(true);
  });
});

describe("verifyAuditChain — tamper detection", () => {
  beforeAll(clearLogs);

  it("detects a tampered action field", async () => {
    const first = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ORIGINAL_ACTION",
      entity: "Entity",
      entityId: "e-tamper-1",
      changes: null,
    });
    await sleep(10);

    await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ACTION_2",
      entity: "Entity",
      entityId: "e-tamper-2",
      changes: null,
    });

    // Tamper: change the action of the first entry
    await prisma.auditLog.update({
      where: { id: first.id },
      data: { action: "TAMPERED_ACTION" },
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });

    const result = verifyAuditChain(logs);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(first.id);
    expect(result.reason).toBeDefined();
  });

  it("detects a tampered previousHash field", async () => {
    await clearLogs();

    await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ENTRY_1",
      entity: "Entity",
      entityId: "e1",
      changes: null,
    });
    await sleep(10);

    const second = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "ENTRY_2",
      entity: "Entity",
      entityId: "e2",
      changes: null,
    });

    // Tamper: overwrite the previousHash pointer
    await prisma.auditLog.update({
      where: { id: second.id },
      data: { previousHash: "0000000000000000000000000000000000000000000000000000000000000000" },
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });

    const result = verifyAuditChain(logs);
    expect(result.ok).toBe(false);
    // The broken entry can be the tampered one or the one that links to it
    expect(result.brokenAtId).toBeDefined();
  });

  it("detects a tampered currentHash field", async () => {
    await clearLogs();

    const entry = await createAuditLog(prisma, {
      organizationId,
      userId,
      action: "WILL_BE_TAMPERED",
      entity: "Entity",
      entityId: "e-hash-tamper",
      changes: null,
    });

    // Tamper: flip the stored hash
    await prisma.auditLog.update({
      where: { id: entry.id },
      data: { currentHash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    });

    const logs = await prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ timestamp: "asc" }],
    });

    const result = verifyAuditChain(logs);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(entry.id);
  });
});
