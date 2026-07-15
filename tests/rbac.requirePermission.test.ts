// Phase 8 Part 1 — RBAC middleware tests: custom-role denial, legacy enum
// fallback, immediate effect of role changes, and cross-org role rejection.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import {
  LEGACY_ROLE_PERMISSIONS,
  resolvePermission,
} from "@/server/services/rbac/permissions";

const prisma = new PrismaClient();

const testRouter = createTRPCRouter({
  writeControls: permissionProcedure("controls.write").mutation(() => "ok"),
  readControls: permissionProcedure("controls.read").query(() => "ok"),
  manageSso: permissionProcedure("sso.configure").mutation(() => "ok"),
});

function callerFor(orgId: string, userId: string, role: Role) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "t@t.test", name: "T", organizationId: orgId, role },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;
let otherOrgId: string;

async function seedUser(role: Role, customRoleId?: string) {
  return prisma.user.create({
    data: {
      email: `rbac-${Date.now()}-${Math.random()}@test.com`,
      organizationId: orgId,
      role,
      customRoleId: customRoleId ?? null,
    },
  });
}

beforeAll(async () => {
  orgId = (
    await prisma.organization.create({
      data: { name: `RbacOrg ${Date.now()}-${Math.random()}` },
    })
  ).id;
  otherOrgId = (
    await prisma.organization.create({
      data: { name: `RbacOrgB ${Date.now()}-${Math.random()}` },
    })
  ).id;
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("requirePermission middleware", () => {
  it("denies a custom role with controls.write: false, even for a legacy ADMIN", async () => {
    const restrictedRole = await prisma.customRole.create({
      data: {
        organizationId: orgId,
        name: `ReadOnly-${Date.now()}`,
        permissions: { "controls.read": true, "controls.write": false },
      },
    });
    // Legacy enum says ADMIN (would allow everything) — the custom role must win.
    const user = await seedUser(Role.ADMIN, restrictedRole.id);
    const caller = callerFor(orgId, user.id, Role.ADMIN);

    await expect(caller.writeControls()).rejects.toThrow(/controls.write/);
    await expect(caller.readControls()).resolves.toBe("ok");
  });

  it("a permission key absent from the custom role is denied (no enum fall-through)", async () => {
    const role = await prisma.customRole.create({
      data: {
        organizationId: orgId,
        name: `NoSso-${Date.now()}`,
        permissions: { "controls.read": true },
      },
    });
    const user = await seedUser(Role.ADMIN, role.id);
    const caller = callerFor(orgId, user.id, Role.ADMIN);
    await expect(caller.manageSso()).rejects.toThrow(/sso.configure/);
  });

  it("legacy enum fallback still works for members without a customRoleId", async () => {
    const admin = await seedUser(Role.ADMIN);
    const viewer = await seedUser(Role.VIEWER);

    await expect(
      callerFor(orgId, admin.id, Role.ADMIN).writeControls(),
    ).resolves.toBe("ok");
    await expect(
      callerFor(orgId, viewer.id, Role.VIEWER).writeControls(),
    ).rejects.toThrow(/controls.write/);
    await expect(
      callerFor(orgId, viewer.id, Role.VIEWER).readControls(),
    ).resolves.toBe("ok");
  });

  it("permission changes take effect immediately (no session-cached bypass)", async () => {
    const role = await prisma.customRole.create({
      data: {
        organizationId: orgId,
        name: `Flip-${Date.now()}`,
        permissions: { "controls.write": true, "controls.read": true },
      },
    });
    const user = await seedUser(Role.VIEWER, role.id);
    const caller = callerFor(orgId, user.id, Role.VIEWER);

    await expect(caller.writeControls()).resolves.toBe("ok");

    await prisma.customRole.update({
      where: { id: role.id },
      data: { permissions: { "controls.write": false, "controls.read": true } },
    });

    await expect(caller.writeControls()).rejects.toThrow(/controls.write/);
  });

  it("deactivated (SCIM-deprovisioned) users are blocked outright", async () => {
    const user = await seedUser(Role.ADMIN);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(
      callerFor(orgId, user.id, Role.ADMIN).readControls(),
    ).rejects.toThrow(/deactivated/);
  });

  it("a custom role belonging to another org never grants access", () => {
    // Guarded at assignment time by roles.assignToMember; resolvePermission
    // is the defense-in-depth layer.
    expect(
      resolvePermission(
        {
          role: Role.VIEWER,
          organizationId: orgId,
          customRole: {
            organizationId: otherOrgId,
            permissions: { "controls.write": true },
          },
        },
        "controls.write",
      ),
    ).toBe(false);
  });

  it("legacy mapping sanity: ADMIN has every key, VIEWER is read-only", () => {
    expect(LEGACY_ROLE_PERMISSIONS.ADMIN["sso.configure"]).toBe(true);
    expect(LEGACY_ROLE_PERMISSIONS.VIEWER["controls.write"]).toBeUndefined();
    expect(LEGACY_ROLE_PERMISSIONS.VIEWER["controls.read"]).toBe(true);
    expect(LEGACY_ROLE_PERMISSIONS.COMPLIANCE_MANAGER["billing.manage"]).toBeUndefined();
  });
});
