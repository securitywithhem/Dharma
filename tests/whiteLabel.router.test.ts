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
});
