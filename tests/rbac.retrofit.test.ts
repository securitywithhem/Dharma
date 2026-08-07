/**
 * WAVE 9.1 — the RBAC retrofit.
 *
 * Closes fullstack-audit-2026-08-06 BE-3: `permissionProcedure` was used by 6
 * of 31 routers; everything else gated on the legacy JWT-embedded `role` enum
 * via managerProcedure/adminProcedure. At least 13 of the 22 PERMISSION_KEYS
 * were settable in the Roles UI and enforced nothing — the product sold a
 * control it did not have.
 *
 * Two halves, and BOTH matter:
 *
 *   1. A custom role that REVOKES a key must now actually be refused. That is
 *      the finding.
 *   2. A legacy role must be unaffected. The retrofit swaps managerProcedure
 *      for permissionProcedure(key), which is only safe because
 *      LEGACY_ROLE_PERMISSIONS[COMPLIANCE_MANAGER] mirrors hasManagementAccess.
 *      If that equivalence ever breaks, this suite catches it rather than a
 *      customer discovering their managers locked out.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import {
  PERMISSION_KEYS,
  LEGACY_ROLE_PERMISSIONS,
  type PermissionKey,
} from "@/server/services/rbac/permissions";
import { hasManagementAccess, isAdminRole } from "@/server/rbac";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { closeSessionIdentityRedis } from "@/server/lib/sessionIdentity";
import { seedRoleUser } from "./fixtures/seedRoleUser";
import { readFileSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

/**
 * A stand-in router exposing one procedure per key, so each key can be
 * exercised without dragging in the real routers' business logic (which needs
 * frameworks, connectors, MinIO, queues…). The middleware under test is the
 * same factory the real routers now use.
 */
const testRouter = createTRPCRouter(
  Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key.replace(".", "_"),
      permissionProcedure(key).query(() => "ok"),
    ]),
  ) as Record<string, ReturnType<typeof permissionProcedure> extends never ? never : any>,
);

function callerFor(user: { id: string; organizationId: string; role: Role }) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: user.id,
        email: "rbac@test.dharma",
        name: "RBAC Test",
        organizationId: user.organizationId,
        role: user.role,
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

/** The 13 keys the audit named as settable-but-unenforced. */
const RETROFITTED_KEYS: PermissionKey[] = [
  "controls.read",
  "controls.write",
  "evidence.read",
  "evidence.upload",
  "policies.read",
  "policies.write",
  "billing.manage",
  "connectors.manage",
  "pentest.request",
  "vulns.manage",
  "marketplace.publish",
  "reports.generate",
];

let orgId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `rbac-${Date.now()}` } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.customRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

/** A user whose custom role grants everything EXCEPT `denied`. */
async function userWithoutPermission(denied: PermissionKey, legacyRole = Role.ADMIN) {
  const permissions = Object.fromEntries(
    PERMISSION_KEYS.filter((k) => k !== denied).map((k) => [k, true]),
  );
  const role = await prisma.customRole.create({
    data: {
      organizationId: orgId,
      name: `no-${denied}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      permissions,
    },
  });
  const user = await seedRoleUser(prisma, orgId, legacyRole, "rbac");
  await prisma.user.update({ where: { id: user.id }, data: { customRoleId: role.id } });
  return { ...user, customRoleId: role.id };
}

describe("a custom role that revokes a key is now actually refused (BE-3)", () => {
  it.each(RETROFITTED_KEYS)(
    "%s is denied even though the legacy role is ADMIN",
    async (key) => {
      // The audit's exact repro shape: a custom role with the permission
      // disabled, assigned to a user whose legacy Role would otherwise allow
      // it. Before the retrofit these all returned "ok".
      const user = await userWithoutPermission(key);
      const caller = callerFor(user) as Record<string, () => Promise<string>>;

      await expect(caller[key.replace(".", "_")]()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    },
  );

  it("grants the same key when the custom role allows it", async () => {
    // Control: proves the refusals above are the permission check, not a
    // blanket failure of custom-role users.
    const user = await userWithoutPermission("billing.manage");
    const caller = callerFor(user) as Record<string, () => Promise<string>>;
    await expect(caller["controls_write"]()).resolves.toBe("ok");
  });
});

describe("legacy roles are unaffected by the retrofit", () => {
  // The retrofit swapped managerProcedure -> permissionProcedure(key). That is
  // only behaviour-preserving because the legacy manager set mirrors
  // hasManagementAccess. Pin the equivalence.
  const MANAGER_KEYS: PermissionKey[] = [
    "controls.write",
    "evidence.upload",
    "policies.write",
    "connectors.manage",
    "pentest.request",
    "vulns.manage",
  ];

  it.each(MANAGER_KEYS)("a COMPLIANCE_MANAGER still has %s", async (key) => {
    const user = await seedRoleUser(prisma, orgId, Role.COMPLIANCE_MANAGER, "rbac");
    const caller = callerFor(user) as Record<string, () => Promise<string>>;
    await expect(caller[key.replace(".", "_")]()).resolves.toBe("ok");
  });

  it.each(MANAGER_KEYS)("a VIEWER still lacks %s", async (key) => {
    const user = await seedRoleUser(prisma, orgId, Role.VIEWER, "rbac");
    const caller = callerFor(user) as Record<string, () => Promise<string>>;
    await expect(caller[key.replace(".", "_")]()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("every manager key matches hasManagementAccess exactly", () => {
    // The invariant the retrofit rests on, asserted directly rather than
    // inferred: for each key the manager set grants, ADMIN and
    // COMPLIANCE_MANAGER must be exactly the roles hasManagementAccess allows.
    for (const key of MANAGER_KEYS) {
      for (const role of Object.values(Role)) {
        const legacyGrants = LEGACY_ROLE_PERMISSIONS[role]?.[key] === true;
        expect({ key, role, legacyGrants }).toEqual({
          key,
          role,
          legacyGrants: hasManagementAccess(role),
        });
      }
    }
  });

  it("reports.generate stays admin-only, so making it enforce did not widen access", () => {
    // report.ts was adminProcedure-gated. Swapping it to
    // permissionProcedure("reports.generate") while the legacy manager set
    // still contained that key would have handed every COMPLIANCE_MANAGER
    // report access as a side effect of a security fix.
    for (const role of Object.values(Role)) {
      const legacyGrants = LEGACY_ROLE_PERMISSIONS[role]?.["reports.generate"] === true;
      expect({ role, legacyGrants }).toEqual({ role, legacyGrants: isAdminRole(role) });
    }
  });

  it("billing.manage is admin-only — the retrofit narrowed it from any org member", () => {
    // billing.ts's mutations were on bare orgProcedure: ANY member could change
    // billing details, start a checkout, or cancel the subscription.
    for (const role of Object.values(Role)) {
      const legacyGrants = LEGACY_ROLE_PERMISSIONS[role]?.["billing.manage"] === true;
      expect({ role, legacyGrants }).toEqual({ role, legacyGrants: isAdminRole(role) });
    }
  });
});

describe("the retrofit actually reached the routers", () => {
  // The audit's methodology applied to the fix: a partial generalization that
  // misses routers is not done. Reads the sources so a revert is caught here.
  const ROUTERS = path.join(__dirname, "..", "src", "server", "routers");

  it.each([
    ["control.ts", "controls.write"],
    ["controlMapping.ts", "controls.write"],
    ["framework.ts", "controls.write"],
    ["readiness.ts", "controls.write"],
    ["evidence.ts", "evidence.upload"],
    ["aiIngestion.ts", "evidence.upload"],
    ["evidenceMapping.ts", "connectors.manage"],
    ["connector.ts", "connectors.manage"],
    ["pentest.ts", "pentest.request"],
    ["vulnerability.ts", "vulns.manage"],
    ["policy.ts", "policies.write"],
    ["report.ts", "reports.generate"],
    ["billing.ts", "billing.manage"],
    ["marketplace.ts", "marketplace.publish"],
  ])("%s gates on %s", (file, key) => {
    const source = readFileSync(path.join(ROUTERS, file), "utf8");
    // Either quote style — this repo mixes them across routers.
    const gated =
      source.includes(`permissionProcedure("${key}")`) ||
      source.includes(`permissionProcedure('${key}')`);
    expect({ file, gated }).toEqual({ file, gated: true });
  });

  it("no retrofitted router still uses managerProcedure", () => {
    const retrofitted = [
      "control.ts", "controlMapping.ts", "framework.ts", "readiness.ts",
      "evidence.ts", "aiIngestion.ts", "evidenceMapping.ts", "connector.ts",
      "pentest.ts", "vulnerability.ts", "policy.ts",
    ];
    for (const file of retrofitted) {
      const source = readFileSync(path.join(ROUTERS, file), "utf8");
      expect({ file, managerProcedure: source.includes("managerProcedure") }).toEqual({
        file,
        managerProcedure: false,
      });
    }
  });
});
