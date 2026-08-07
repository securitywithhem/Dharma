/**
 * WAVE 5.2 — the seven orphaned routes are now reachable, and only by the
 * right people.
 *
 * fullstack-audit-2026-08-06 §4 HIGH-1: `/dashboard/mssp*`,
 * `/dashboard/publisher/*` and `/dashboard/admin/marketplace*` had zero inbound
 * links anywhere in the app — the MSSP dashboard, a headline Phase 8
 * deliverable, was reachable only by typing the URL.
 *
 * Two halves, both needed: the nav list must actually contain them (otherwise
 * they are still orphaned), and `user.capabilities` must gate them
 * correctly (otherwise the sidebar advertises sections the API refuses).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { userRouter } from "@/server/routers/user";
import { closeSessionIdentityRedis } from "@/server/lib/sessionIdentity";
import { navGroups, type NavGate } from "@/lib/navigation";
import { seedRoleUser } from "./fixtures/seedRoleUser";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ user: userRouter });

function callerFor(user: { id: string; organizationId: string; role: Role }) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: user.id,
        email: "nav@test.dharma",
        name: "Nav Test",
        organizationId: user.organizationId,
        role: user.role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `nav-${Date.now()}` } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("the previously-orphaned routes are in the nav", () => {
  const allItems = navGroups.flatMap((g) => g.items);

  it.each([
    ["/dashboard/mssp", "mssp"],
    ["/dashboard/publisher/items", "publisher"],
    ["/dashboard/admin/marketplace", "platformAdmin"],
  ])("%s is present and gated on %s", (href, gate) => {
    const item = allItems.find((i) => i.href === href);
    expect(item).toBeDefined();
    expect(item!.gate).toBe(gate as NavGate);
  });

  it("leaves the ungated items ungated, so an ordinary member's sidebar is unchanged", () => {
    const ungated = allItems.filter((i) => !i.gate).map((i) => i.href);
    expect(ungated).toContain("/dashboard");
    expect(ungated).toContain("/dashboard/frameworks");
    expect(ungated).toContain("/dashboard/marketplace");
  });
});

describe("user.capabilities", () => {
  it("grants nothing extra to an ordinary viewer", async () => {
    const viewer = await seedRoleUser(prisma, orgId, Role.VIEWER, "nav");
    const caps = await callerFor(viewer).user.capabilities();

    expect(caps).toEqual({
      mssp: false,
      publisher: false,
      platformAdmin: false,
      policiesWrite: false,
    });
  });

  it("grants publisher to a PUBLISHER but not moderation", async () => {
    const publisher = await seedRoleUser(prisma, orgId, Role.PUBLISHER, "nav");
    const caps = await callerFor(publisher).user.capabilities();

    expect(caps.publisher).toBe(true);
    expect(caps.platformAdmin).toBe(false);
  });

  it("does NOT grant platformAdmin to a tenant ADMIN", async () => {
    // The whole point of BE-2: a tenant admin is an admin of their own org,
    // not of the shared catalogue.
    const admin = await seedRoleUser(prisma, orgId, Role.ADMIN, "nav");
    const caps = await callerFor(admin).user.capabilities();

    expect(caps.publisher).toBe(true);
    expect(caps.platformAdmin).toBe(false);
  });

  it("grants platformAdmin only to a user with the out-of-band flag", async () => {
    const operator = await seedRoleUser(prisma, orgId, Role.ADMIN, "nav");
    await prisma.user.update({
      where: { id: operator.id },
      data: { isPlatformAdmin: true },
    });

    const caps = await callerFor(operator).user.capabilities();
    expect(caps.platformAdmin).toBe(true);
  });

  // WAVE 7: policiesWrite must mirror the server gate on
  // policy.update/publish/delete (managerProcedure -> hasManagementAccess)
  // EXACTLY, or the policy detail page renders controls the API refuses.
  it.each([
    [Role.VIEWER, false],
    [Role.PUBLISHER, false],
    [Role.COMPLIANCE_MANAGER, true],
    [Role.ADMIN, true],
  ])("policiesWrite for %s is %s, matching managerProcedure", async (role, expected) => {
    const user = await seedRoleUser(prisma, orgId, role, "nav");
    const caps = await callerFor(user).user.capabilities();
    expect(caps.policiesWrite).toBe(expected);
  });

  it("grants mssp from the permission, not from a role name", async () => {
    const role = await prisma.customRole.create({
      data: {
        organizationId: orgId,
        name: `Mssp-${Date.now()}`,
        permissions: { "mssp.viewAllClients": true },
      },
    });
    const user = await seedRoleUser(prisma, orgId, Role.VIEWER, "nav");
    await prisma.user.update({
      where: { id: user.id },
      data: { customRoleId: role.id },
    });

    const caps = await callerFor(user).user.capabilities();
    expect(caps.mssp).toBe(true);
  });
});
