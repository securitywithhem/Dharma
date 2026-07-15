// Phase 8 Part 3 — MSSP tests. Negative tests deliberately outnumber
// positive ones: this is the only cross-tenant read path in the app.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { msspRouter } from "@/server/routers/mssp";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ mssp: msspRouter });

function callerFor(orgId: string, userId: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "m@m.test", name: "M", organizationId: orgId, role },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

async function seedOrg(label: string) {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const admin = await prisma.user.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@test.com`,
      organizationId: org.id,
      role: Role.ADMIN,
    },
  });
  return { org, admin };
}

let mssp: Awaited<ReturnType<typeof seedOrg>>; // the MSSP's own org
let clientA: Awaited<ReturnType<typeof seedOrg>>;
let clientB: Awaited<ReturnType<typeof seedOrg>>;
let clientC: Awaited<ReturnType<typeof seedOrg>>; // in group but NOT in grant scope
let groupId: string;
let grantId: string;

beforeAll(async () => {
  mssp = await seedOrg("MsspParent");
  clientA = await seedOrg("MsspClientA");
  clientB = await seedOrg("MsspClientB");
  clientC = await seedOrg("MsspClientC");

  const group = await prisma.organizationGroup.create({
    data: { name: `Group-${Date.now()}`, parentOrgId: mssp.org.id },
  });
  groupId = group.id;
  await prisma.organization.updateMany({
    where: { id: { in: [clientA.org.id, clientB.org.id, clientC.org.id] } },
    data: { groupId: group.id },
  });

  // Grant covers A and B only — C is in the group but NOT in scope.
  const grant = await prisma.msspGrant.create({
    data: {
      groupId: group.id,
      grantedUserId: mssp.admin.id,
      scopeOrgIds: [clientA.org.id, clientB.org.id],
    },
  });
  grantId = grant.id;
});

afterAll(async () => {
  await prisma.organizationGroup.delete({ where: { id: groupId } }).catch(() => undefined);
  for (const seeded of [mssp, clientA, clientB, clientC]) {
    await prisma.organization
      .delete({ where: { id: seeded.org.id } })
      .catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("MSSP negative paths (must all be denied)", () => {
  it("a user WITHOUT any grant cannot call clientOverview", async () => {
    const stranger = await prisma.user.create({
      data: {
        email: `stranger-${Date.now()}@test.com`,
        organizationId: mssp.org.id,
        role: Role.ADMIN,
      },
    });
    const caller = callerFor(mssp.org.id, stranger.id);
    await expect(caller.mssp.clientOverview({ grantId })).rejects.toThrow(/not found/i);
  });

  it("a grant scoped to [A, B] cannot drill into C even though C is in the same group", async () => {
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    await expect(
      caller.mssp.drillDown({ grantId, orgId: clientC.org.id }),
    ).rejects.toThrow(/does not cover/);
  });

  it("clientOverview never returns orgs outside the grant scope", async () => {
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    const overview = await caller.mssp.clientOverview({ grantId });
    const ids = overview.map((o) => o.organizationId).sort();
    expect(ids).toEqual([clientA.org.id, clientB.org.id].sort());
    expect(ids).not.toContain(clientC.org.id);
  });

  it("an expired grant is rejected even though the role still has mssp.viewAllClients", async () => {
    const expired = await prisma.msspGrant.create({
      data: {
        groupId,
        grantedUserId: mssp.admin.id,
        scopeOrgIds: [clientA.org.id],
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    await expect(caller.mssp.clientOverview({ grantId: expired.id })).rejects.toThrow(
      /expired/,
    );
    await expect(
      caller.mssp.drillDown({ grantId: expired.id, orgId: clientA.org.id }),
    ).rejects.toThrow(/expired/);
  });

  it("revoking a grant blocks further aggregate AND drill-down queries immediately", async () => {
    const revocable = await prisma.msspGrant.create({
      data: {
        groupId,
        grantedUserId: mssp.admin.id,
        scopeOrgIds: [clientA.org.id],
      },
    });
    const caller = callerFor(mssp.org.id, mssp.admin.id);

    // Works before revocation (proves the block is the revocation, not setup).
    await expect(
      caller.mssp.clientOverview({ grantId: revocable.id }),
    ).resolves.toBeDefined();

    await caller.mssp.revokeGrant({ grantId: revocable.id });

    await expect(caller.mssp.clientOverview({ grantId: revocable.id })).rejects.toThrow(
      /revoked/,
    );
    await expect(
      caller.mssp.drillDown({ grantId: revocable.id, orgId: clientA.org.id }),
    ).rejects.toThrow(/revoked/);
  });

  it("drill-down re-validates the grant on EVERY call — revocation between calls blocks the second", async () => {
    const shortLived = await prisma.msspGrant.create({
      data: {
        groupId,
        grantedUserId: mssp.admin.id,
        scopeOrgIds: [clientA.org.id],
      },
    });
    const caller = callerFor(mssp.org.id, mssp.admin.id);

    await expect(
      caller.mssp.drillDown({ grantId: shortLived.id, orgId: clientA.org.id }),
    ).resolves.toBeDefined();

    await prisma.msspGrant.update({
      where: { id: shortLived.id },
      data: { revokedAt: new Date() },
    });

    await expect(
      caller.mssp.drillDown({ grantId: shortLived.id, orgId: clientA.org.id }),
    ).rejects.toThrow(/revoked/);
  });

  it("someone else's grantId is treated as NOT_FOUND (no existence oracle)", async () => {
    const otherAdmin = await prisma.user.create({
      data: {
        email: `other-admin-${Date.now()}@test.com`,
        organizationId: mssp.org.id,
        role: Role.ADMIN,
      },
    });
    const caller = callerFor(mssp.org.id, otherAdmin.id);
    await expect(caller.mssp.clientOverview({ grantId })).rejects.toThrow(/not found/i);
  });

  it("createGrant rejects scope orgs that are not members of the group", async () => {
    const outsider = await seedOrg("MsspOutsider");
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    await expect(
      caller.mssp.createGrant({
        groupId,
        grantedUserId: mssp.admin.id,
        scopeOrgIds: [outsider.org.id],
      }),
    ).rejects.toThrow(/not in this group/);
    await prisma.organization.delete({ where: { id: outsider.org.id } });
  });

  it("createGrant/revokeGrant reject callers from a different org than the group's parent", async () => {
    const foreignCaller = callerFor(clientA.org.id, clientA.admin.id);
    await expect(
      foreignCaller.mssp.createGrant({
        groupId,
        grantedUserId: clientA.admin.id,
        scopeOrgIds: [clientA.org.id],
      }),
    ).rejects.toThrow(/not found/i);
    await expect(foreignCaller.mssp.revokeGrant({ grantId })).rejects.toThrow(
      /NOT_FOUND|not found/i,
    );
  });

  it("a VIEWER without mssp.viewAllClients is stopped by RBAC before any grant logic", async () => {
    const viewer = await prisma.user.create({
      data: {
        email: `mssp-viewer-${Date.now()}@test.com`,
        organizationId: mssp.org.id,
        role: Role.VIEWER,
      },
    });
    const caller = callerFor(mssp.org.id, viewer.id, Role.VIEWER);
    await expect(caller.mssp.clientOverview({ grantId })).rejects.toThrow(
      /mssp.viewAllClients/,
    );
  });
});

describe("MSSP positive paths", () => {
  it("aggregate view returns tiles and writes a detailed MSSP_AGGREGATE_VIEWED audit event", async () => {
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    const overview = await caller.mssp.clientOverview({ grantId });
    expect(overview).toHaveLength(2);

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: mssp.org.id,
        action: "MSSP_AGGREGATE_VIEWED",
        userId: mssp.admin.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    const changes = audit?.changes as { scopeOrgIds?: string[]; resultOrgCount?: number };
    expect(changes.scopeOrgIds).toEqual([clientA.org.id, clientB.org.id]);
    expect(changes.resultOrgCount).toBe(2);
  });

  it("drill-down into an in-scope org returns data and audits MSSP_DRILLDOWN_VIEWED", async () => {
    const caller = callerFor(mssp.org.id, mssp.admin.id);
    const detail = await caller.mssp.drillDown({ grantId, orgId: clientA.org.id });
    expect(detail.organization.id).toBe(clientA.org.id);

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: mssp.org.id,
        action: "MSSP_DRILLDOWN_VIEWED",
        entityId: clientA.org.id,
      },
    });
    expect(audit).not.toBeNull();
  });

  it("load: clientOverview across 50 client orgs stays reasonable", async () => {
    const bulk = await prisma.organization.createManyAndReturn({
      data: Array.from({ length: 50 }, (_, i) => ({
        name: `LoadClient-${i}-${Date.now()}`,
        groupId,
      })),
      select: { id: true },
    });
    const bigGrant = await prisma.msspGrant.create({
      data: {
        groupId,
        grantedUserId: mssp.admin.id,
        scopeOrgIds: bulk.map((o) => o.id),
      },
    });

    const caller = callerFor(mssp.org.id, mssp.admin.id);
    const started = performance.now();
    const overview = await caller.mssp.clientOverview({ grantId: bigGrant.id });
    const elapsedMs = Math.round(performance.now() - started);

    expect(overview).toHaveLength(50);
    // TRD p95 < 200ms is the general goal; a 50-org aggregate is a documented
    // exception — assert a sane ceiling and report the number in the summary.
    expect(elapsedMs).toBeLessThan(2000);
    console.info(`[load] mssp.clientOverview over 50 orgs took ${elapsedMs}ms`);

    await prisma.organization.deleteMany({
      where: { id: { in: bulk.map((o) => o.id) } },
    });
  });
});
