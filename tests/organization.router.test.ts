/**
 * tests/organization.router.test.ts
 *
 * Integration tests for the organization router backing Settings → Team.
 * Covers the happy path plus cross-org isolation: a caller must never be
 * able to read or mutate a member belonging to another organization.
 *
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/routers";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/dharma_test",
    },
  },
});

let orgAId: string;
let orgBId: string;
let adminAId: string;
let memberAId: string;
let memberBId: string;

function createCaller(orgId: string, uid: string, role: Role = Role.ADMIN) {
  const callerFactory = createCallerFactory(appRouter);
  return callerFactory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: uid,
        email: "admin@example.com",
        name: "Test Admin",
        organizationId: orgId,
        role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

beforeAll(async () => {
  const stamp = Date.now();

  const orgA = await prisma.organization.create({
    data: { name: `Org A — organization router ${stamp}` },
  });
  orgAId = orgA.id;

  const orgB = await prisma.organization.create({
    data: { name: `Org B — organization router ${stamp}` },
  });
  orgBId = orgB.id;

  const adminA = await prisma.user.create({
    data: {
      email: `admin-a-${stamp}@example.com`,
      name: "Admin A",
      role: Role.ADMIN,
      organizationId: orgAId,
    },
  });
  adminAId = adminA.id;

  // A second admin in org A so last-admin guards don't fire during tests that
  // legitimately change/remove a member.
  const memberA = await prisma.user.create({
    data: {
      email: `member-a-${stamp}@example.com`,
      name: "Member A",
      role: Role.ADMIN,
      organizationId: orgAId,
    },
  });
  memberAId = memberA.id;

  const memberB = await prisma.user.create({
    data: {
      email: `member-b-${stamp}@example.com`,
      name: "Member B",
      role: Role.VIEWER,
      organizationId: orgBId,
    },
  });
  memberBId = memberB.id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgAId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgBId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("organization.listMembers", () => {
  it("returns only members of the caller's organization", async () => {
    const caller = createCaller(orgAId, adminAId);
    const result = await caller.organization.listMembers({ page: 1, limit: 25 });

    const ids = result.members.map((m) => m.id);
    expect(ids).toContain(adminAId);
    expect(ids).toContain(memberAId);
    // The critical assertion: org B's member must not leak into org A's roster.
    expect(ids).not.toContain(memberBId);
    expect(result.total).toBe(2);
  });

  it("reports pagination metadata", async () => {
    const caller = createCaller(orgAId, adminAId);
    const result = await caller.organization.listMembers({ page: 1, limit: 1 });

    expect(result.members).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(2);
  });

  it("exposes joinedAt rather than a fabricated last-active value", async () => {
    const caller = createCaller(orgAId, adminAId);
    const result = await caller.organization.listMembers({ page: 1, limit: 25 });

    expect(result.members[0]).toHaveProperty("joinedAt");
    expect(result.members[0]).not.toHaveProperty("lastActiveAt");
  });
});

describe("organization.updateMemberRole", () => {
  it("updates the role of a member in the caller's org", async () => {
    const caller = createCaller(orgAId, adminAId);
    const updated = await caller.organization.updateMemberRole({
      userId: memberAId,
      role: "PUBLISHER",
    });

    expect(updated.role).toBe("PUBLISHER");

    // restore for later tests
    await prisma.user.update({
      where: { id: memberAId },
      data: { role: Role.ADMIN },
    });
  });

  it("refuses to change a member in another organization", async () => {
    const caller = createCaller(orgAId, adminAId);

    await expect(
      caller.organization.updateMemberRole({ userId: memberBId, role: "ADMIN" }),
    ).rejects.toThrow(/not found/i);

    // and the target must be untouched
    const untouched = await prisma.user.findUnique({ where: { id: memberBId } });
    expect(untouched?.role).toBe(Role.VIEWER);
  });

  it("refuses to let a caller change their own role", async () => {
    const caller = createCaller(orgAId, adminAId);

    await expect(
      caller.organization.updateMemberRole({ userId: adminAId, role: "VIEWER" }),
    ).rejects.toThrow(/your own role/i);
  });
});

describe("organization.removeMember", () => {
  it("refuses to remove a member in another organization", async () => {
    const caller = createCaller(orgAId, adminAId);

    await expect(
      caller.organization.removeMember({ userId: memberBId }),
    ).rejects.toThrow(/not found/i);

    const untouched = await prisma.user.findUnique({ where: { id: memberBId } });
    expect(untouched?.isActive).toBe(true);
  });

  it("refuses to let a caller remove themselves", async () => {
    const caller = createCaller(orgAId, adminAId);

    await expect(
      caller.organization.removeMember({ userId: adminAId }),
    ).rejects.toThrow(/yourself/i);
  });

  it("soft-deletes the member so audit attribution survives", async () => {
    const caller = createCaller(orgAId, adminAId);
    await caller.organization.removeMember({ userId: memberAId });

    const removed = await prisma.user.findUnique({ where: { id: memberAId } });
    expect(removed).not.toBeNull();
    expect(removed?.isActive).toBe(false);
  });

  it("refuses to remove the last remaining admin", async () => {
    // Reaching this guard requires a caller who holds members.invite but is
    // NOT themselves an admin — under the legacy Role enum only ADMIN has
    // members.invite, and an admin removing the sole admin is caught earlier
    // by the self-removal guard. A custom role is the real-world path, so
    // that is what this exercises.
    const stamp = Date.now();
    const role = await prisma.customRole.create({
      data: {
        organizationId: orgAId,
        name: `Member Manager ${stamp}`,
        permissions: { "members.invite": true },
      },
    });

    const manager = await prisma.user.create({
      data: {
        email: `manager-a-${stamp}@example.com`,
        name: "Member Manager",
        role: Role.VIEWER,
        organizationId: orgAId,
        customRoleId: role.id,
      },
    });

    // memberA was deactivated above, leaving adminA as the only active admin.
    const caller = createCaller(orgAId, manager.id, Role.VIEWER);
    await expect(
      caller.organization.removeMember({ userId: adminAId }),
    ).rejects.toThrow(/last administrator/i);

    // and adminA must still be active
    const stillThere = await prisma.user.findUnique({ where: { id: adminAId } });
    expect(stillThere?.isActive).toBe(true);
  });
});
