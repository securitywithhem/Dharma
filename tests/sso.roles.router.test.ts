// Phase 8 Part 1 — sso + roles router tests: config redaction, the two-step
// enforceSsoOnly confirmation, SCIM token show-once semantics, default-role
// protections, and cross-org assignment rejection.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createHash } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { ssoRouter } from "@/server/routers/sso";
import { rolesRouter } from "@/server/routers/roles";
import {
  generateIdpKeys,
  certBody,
  buildIdpMetadataXml,
} from "./helpers/samlTestIdp";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ sso: ssoRouter, roles: rolesRouter });

function callerFor(orgId: string, userId: string, role: Role) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "a@a.test", name: "A", organizationId: orgId, role },
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
      email: `${label}-admin-${Date.now()}@test.com`,
      organizationId: org.id,
      role: Role.ADMIN,
    },
  });
  return { org, admin };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  a = await seedOrg("SsoRouterA");
  b = await seedOrg("SsoRouterB");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: a.org.id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: b.org.id } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("sso router", () => {
  it("blocks non-admin roles via requirePermission", async () => {
    const viewer = await prisma.user.create({
      data: {
        email: `viewer-${Date.now()}@test.com`,
        organizationId: a.org.id,
        role: Role.VIEWER,
      },
    });
    const caller = callerFor(a.org.id, viewer.id, Role.VIEWER);
    await expect(caller.sso.getConfig()).rejects.toThrow(/sso.configure/);
  });

  it("configureSaml validates metadata, saves per-org, and returns the ACS URL", async () => {
    const keys = generateIdpKeys();
    const metadata = buildIdpMetadataXml("https://idp.a.test", "https://idp.a.test/sso", keys);
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);

    const result = await caller.sso.configureSaml({ metadataXmlOrUrl: metadata });
    expect(result.acsUrl).toContain(`/api/sso/saml/${a.org.id}/callback`);

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: a.org.id },
    });
    const stored = settings?.ssoConfig as Record<string, unknown>;
    expect(stored.entityId).toBe("https://idp.a.test");
    expect(stored.certificate).toBe(certBody(keys.certificate));

    // Tenant isolation: org B remains untouched.
    const bSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId: b.org.id },
    });
    expect(bSettings?.ssoConfig ?? null).toBeNull();
  });

  it("getConfig redacts the certificate body", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    const config = await caller.sso.getConfig();
    expect(config.ssoConfig).not.toBeNull();
    expect((config.ssoConfig as { certificate?: string }).certificate).toMatch(/…$/);
  });

  it("enforceSsoOnly requires the two-step confirmation token and audit-logs the change", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);

    const first = await caller.sso.enforceSsoOnly({ enabled: true });
    expect(first.applied).toBe(false);
    if (first.applied) throw new Error("unreachable");
    expect(first.confirmationToken).toBeTruthy();

    // Wrong token → rejected.
    await expect(
      caller.sso.enforceSsoOnly({ enabled: true, confirmationToken: "bogus" }),
    ).rejects.toThrow(/invalid or expired/);

    // A token minted for a DIFFERENT admin/org must not work.
    const otherCaller = callerFor(b.org.id, b.admin.id, Role.ADMIN);
    await expect(
      otherCaller.sso.enforceSsoOnly({
        enabled: true,
        confirmationToken: first.confirmationToken,
      }),
    ).rejects.toThrow();

    const second = await caller.sso.enforceSsoOnly({
      enabled: true,
      confirmationToken: first.confirmationToken,
    });
    expect(second.applied).toBe(true);

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: a.org.id },
    });
    expect(settings?.ssoEnforced).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: a.org.id, action: "SSO_ENFORCEMENT_CHANGED" },
    });
    expect(audit).not.toBeNull();
  });

  it("generateScimToken stores only a hash and never persists the plaintext", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    const { token } = await caller.sso.generateScimToken();
    expect(token).toMatch(/^dscim_/);

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: a.org.id },
    });
    expect(settings?.scimEnabled).toBe(true);
    expect(settings?.scimTokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(settings)).not.toContain(token);
  });
});

describe("roles router", () => {
  it("seeds built-in roles on first list and protects them from edit/delete", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    const roles = await caller.roles.list();
    const admin = roles.find((r) => r.name === "Admin");
    expect(admin?.isDefault).toBe(true);

    await expect(
      caller.roles.update({ id: admin!.id, name: "Hacked" }),
    ).rejects.toThrow(/Built-in/);
    await expect(caller.roles.delete({ id: admin!.id })).rejects.toThrow(/Built-in/);
  });

  it("rejects unknown permission keys on create", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    await expect(
      caller.roles.create({
        name: `Bad-${Date.now()}`,
        permissions: { "not.a.key": true },
      }),
    ).rejects.toThrow(/Unknown permission key/);
  });

  it("blocks deleting an assigned role without reassignment, then reassigns", async () => {
    const caller = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    const roleA = await caller.roles.create({
      name: `Holder-${Date.now()}`,
      permissions: { "controls.read": true },
    });
    const roleB = await caller.roles.create({
      name: `Target-${Date.now()}`,
      permissions: { "controls.read": true },
    });
    const member = await prisma.user.create({
      data: {
        email: `holder-${Date.now()}@test.com`,
        organizationId: a.org.id,
        role: Role.VIEWER,
        customRoleId: roleA.id,
      },
    });

    await expect(caller.roles.delete({ id: roleA.id })).rejects.toThrow(/reassign/);

    await caller.roles.delete({ id: roleA.id, reassignToRoleId: roleB.id });
    const moved = await prisma.user.findUnique({ where: { id: member.id } });
    expect(moved?.customRoleId).toBe(roleB.id);
  });

  it("tenant isolation: cannot assign org B's role to an org A member, nor touch org B members", async () => {
    const callerA = callerFor(a.org.id, a.admin.id, Role.ADMIN);
    const callerB = callerFor(b.org.id, b.admin.id, Role.ADMIN);
    const roleB = await callerB.roles.create({
      name: `BRole-${Date.now()}`,
      permissions: { "controls.read": true },
    });
    const memberA = await prisma.user.create({
      data: {
        email: `amember-${Date.now()}@test.com`,
        organizationId: a.org.id,
        role: Role.VIEWER,
      },
    });

    await expect(
      callerA.roles.assignToMember({ userId: memberA.id, customRoleId: roleB.id }),
    ).rejects.toThrow(/Role not found/);
    await expect(
      callerB.roles.assignToMember({ userId: memberA.id, customRoleId: roleB.id }),
    ).rejects.toThrow(/Member not found/);
  });
});
