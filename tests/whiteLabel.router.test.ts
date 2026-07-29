// Phase 8 Part 2 — white-label router tests: validation, cross-org domain
// claims, logo-key prefix enforcement, CNAME verification (DNS mocked at the
// node:dns boundary), and theme activation rules.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";

const mockResolveCname = jest.fn() as jest.Mock;
jest.mock("node:dns/promises", () => ({
  resolveCname: (...args: unknown[]) => mockResolveCname(...args),
}));

// eslint-disable-next-line import/first
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
// eslint-disable-next-line import/first
import { whiteLabelRouter } from "@/server/routers/whiteLabel";
// eslint-disable-next-line import/first
import { parseStoredWhiteLabel } from "@/lib/theme/getTenantTheme";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ whiteLabel: whiteLabelRouter });

function callerFor(orgId: string, userId: string) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: { id: userId, email: "w@w.test", name: "W", organizationId: orgId, role: Role.ADMIN },
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
      email: `${label}-${Date.now()}@test.com`,
      organizationId: org.id,
      role: Role.ADMIN,
    },
  });
  return { org, admin };
}

let a: Awaited<ReturnType<typeof seedOrg>>;
let b: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  a = await seedOrg("WlOrgA");
  b = await seedOrg("WlOrgB");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: a.org.id } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: b.org.id } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("whiteLabel router", () => {
  const domain = `brand-${Date.now()}.example.com`;

  it("rejects an invalid hex color", async () => {
    const caller = callerFor(a.org.id, a.admin.id);
    await expect(
      caller.whiteLabel.updateSettings({ primaryColor: "red" }),
    ).rejects.toThrow();
  });

  it("rejects a logoKey outside the org's own storage prefix", async () => {
    const caller = callerFor(a.org.id, a.admin.id);
    await expect(
      caller.whiteLabel.updateSettings({
        logoKey: `${b.org.id}/white-label/stolen.png`,
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("saves settings and leaves the domain unverified until CNAME check", async () => {
    const caller = callerFor(a.org.id, a.admin.id);
    const saved = await caller.whiteLabel.updateSettings({
      primaryColor: "#3366ff",
      customDomain: domain,
    });
    expect(saved.customDomainVerified).toBe(false);

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: a.org.id },
    });
    expect(parseStoredWhiteLabel(settings?.whiteLabel)?.customDomain).toBe(domain);
  });

  it("tenant isolation: another org cannot claim the same domain", async () => {
    const caller = callerFor(b.org.id, b.admin.id);
    await expect(
      caller.whiteLabel.updateSettings({ customDomain: domain }),
    ).rejects.toThrow(/already claimed/);
  });

  it("verifyCustomDomain fails when the CNAME points elsewhere", async () => {
    mockResolveCname.mockResolvedValue(["wrong.example.net"]);
    const caller = callerFor(a.org.id, a.admin.id);
    await expect(caller.whiteLabel.verifyCustomDomain()).rejects.toThrow(/expected/);
  });

  it("verifyCustomDomain activates on a correct CNAME and audit-logs it", async () => {
    // envs/.env.test NEXTAUTH_URL is http://localhost:3000 → expected target "localhost".
    mockResolveCname.mockResolvedValue(["localhost"]);
    const caller = callerFor(a.org.id, a.admin.id);
    const result = await caller.whiteLabel.verifyCustomDomain();
    expect(result.verified).toBe(true);

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: a.org.id },
    });
    expect(parseStoredWhiteLabel(settings?.whiteLabel)?.customDomainVerified).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: a.org.id, action: "WHITE_LABEL_DOMAIN_VERIFIED" },
    });
    expect(audit).not.toBeNull();
  });

  it("changing the domain resets verification", async () => {
    const caller = callerFor(a.org.id, a.admin.id);
    const updated = await caller.whiteLabel.updateSettings({
      customDomain: `other-${Date.now()}.example.com`,
    });
    expect(updated.customDomainVerified).toBe(false);
  });

  describe("resetTheme", () => {
    it("clears the visual overrides but retains the custom domain", async () => {
      const caller = callerFor(a.org.id, a.admin.id);
      const domain = `reset-${Date.now()}.example.com`;
      await caller.whiteLabel.updateSettings({
        primaryColor: "#2F9E6E",
        css: ":root { --radius: 0px; }",
        customDomain: domain,
      });

      const reset = await caller.whiteLabel.resetTheme();

      expect(reset.primaryColor).toBeUndefined();
      expect(reset.css).toBeUndefined();
      expect(reset.logoKey).toBeUndefined();
      // Dropping the domain would take the tenant's URL offline — resetting a
      // theme is a styling action, not a deactivation.
      expect(reset.customDomain).toBe(domain);
    });

    it("audit-logs the reset", async () => {
      const caller = callerFor(a.org.id, a.admin.id);
      await caller.whiteLabel.updateSettings({ primaryColor: "#C9A227" });
      await caller.whiteLabel.resetTheme();

      const entry = await prisma.auditLog.findFirst({
        where: { organizationId: a.org.id, action: "WHITE_LABEL_RESET" },
        orderBy: { createdAt: "desc" },
      });
      expect(entry).not.toBeNull();
      expect(entry?.entity).toBe("OrganizationSettings");
      expect((entry?.changes as { cleared?: string[] })?.cleared).toContain("primaryColor");
    });

    it("tenant isolation: resetting org A's theme leaves org B's untouched", async () => {
      const aCaller = callerFor(a.org.id, a.admin.id);
      const bCaller = callerFor(b.org.id, b.admin.id);

      await bCaller.whiteLabel.updateSettings({ primaryColor: "#123456" });
      await aCaller.whiteLabel.updateSettings({ primaryColor: "#654321" });

      await aCaller.whiteLabel.resetTheme();

      const bSettings = await prisma.organizationSettings.findUnique({
        where: { organizationId: b.org.id },
        select: { whiteLabel: true },
      });
      expect(parseStoredWhiteLabel(bSettings?.whiteLabel)?.primaryColor).toBe("#123456");
    });

    it("is safe to call when the org has no settings row yet", async () => {
      const fresh = await seedOrg("WlOrgC");
      try {
        const caller = callerFor(fresh.org.id, fresh.admin.id);
        await expect(caller.whiteLabel.resetTheme()).resolves.toEqual({});
      } finally {
        await prisma.organization.delete({ where: { id: fresh.org.id } }).catch(() => undefined);
      }
    });
  });
});
