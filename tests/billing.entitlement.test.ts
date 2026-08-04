// Phase 3b — entitlement limit enforcement.
//
// The interesting cases are all at the boundary: off-by-one here either lets
// customers exceed what they paid for, or blocks them one short of it. Both
// are revenue bugs, so the boundary is tested from both sides.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { EntitlementService } from "@/server/services/entitlement";

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

let freePlan: { id: string };
let org: { id: string };

async function addUsers(organizationId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    await prisma.user.create({
      data: {
        email: `ent-${suffix}-${i}-${Math.random()}@test.com`,
        organizationId,
        role: Role.VIEWER,
      },
    });
  }
}

beforeAll(async () => {
  freePlan = await prisma.plan.create({
    data: {
      name: `free-ent-spec-${suffix}`,
      displayName: "Free (spec)",
      price: 0,
      // Same shape as the real free plan seed.
      limits: { users: 5, frameworks: 3, storageMb: 100 },
      features: { apiAccess: false, sso: false, aiAdvisor: false },
    },
  });

  org = await prisma.organization.create({
    data: { name: `EntitlementSpecOrg ${suffix}`, planId: freePlan.id },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.framework.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.plan.deleteMany({ where: { id: freePlan.id } });
  await prisma.$disconnect();
});

describe("user limit on the Free plan (limit: 5)", () => {
  it("allows the 5th user — the limit is inclusive", async () => {
    const service = new EntitlementService(prisma);
    await addUsers(org.id, 4); // 4 existing

    // Adding the 5th must succeed: 4 + 1 = 5, which is at the limit, not over.
    await expect(
      service.checkUsageLimit(org.id, "users", 1),
    ).resolves.toBe(true);

    await addUsers(org.id, 1); // now at 5
    expect(await service.getUsage(org.id, "users")).toBe(5);
  });

  it("blocks the 6th user with FORBIDDEN", async () => {
    const service = new EntitlementService(prisma);

    await expect(service.checkUsageLimit(org.id, "users", 1)).rejects.toThrow(
      TRPCError,
    );

    try {
      await service.checkUsageLimit(org.id, "users", 1);
      throw new Error("expected checkUsageLimit to throw");
    } catch (err) {
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("FORBIDDEN");
      // The message is a monetization surface, not just an error string.
      expect(trpcErr.message).toMatch(/upgrade/i);
    }
  });

  it("blocks a bulk add that would cross the limit, not just a single one", async () => {
    const service = new EntitlementService(prisma);
    // Already at 5; any increment crosses.
    await expect(service.checkUsageLimit(org.id, "users", 3)).rejects.toThrow(
      TRPCError,
    );
  });
});

describe("limits come from the Plan row, not hardcoded constants", () => {
  it("raising the plan's limit immediately unblocks the org", async () => {
    const service = new EntitlementService(prisma);

    // Still at 5 users, currently blocked.
    await expect(service.checkUsageLimit(org.id, "users", 1)).rejects.toThrow();

    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { limits: { users: 25, frameworks: 3, storageMb: 100 } },
    });

    await expect(service.checkUsageLimit(org.id, "users", 1)).resolves.toBe(true);

    // Restore for any later assertions.
    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { limits: { users: 5, frameworks: 3, storageMb: 100 } },
    });
  });

  it("treats -1 as unlimited", async () => {
    const service = new EntitlementService(prisma);
    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { limits: { users: -1, frameworks: 3, storageMb: 100 } },
    });

    await expect(
      service.checkUsageLimit(org.id, "users", 10_000),
    ).resolves.toBe(true);

    await prisma.plan.update({
      where: { id: freePlan.id },
      data: { limits: { users: 5, frameworks: 3, storageMb: 100 } },
    });
  });
});

describe("tenant isolation", () => {
  it("one org's usage never counts against another's limit", async () => {
    const otherOrg = await prisma.organization.create({
      data: { name: `EntitlementSpecOther ${suffix}`, planId: freePlan.id },
    });
    const service = new EntitlementService(prisma);

    // `org` has 5 users and is at its limit; the fresh org has none.
    expect(await service.getUsage(otherOrg.id, "users")).toBe(0);
    await expect(
      service.checkUsageLimit(otherOrg.id, "users", 1),
    ).resolves.toBe(true);

    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
