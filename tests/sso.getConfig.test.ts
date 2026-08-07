/**
 * GH #21 — `sso.getConfig` across the four states the page must render.
 *
 * The reported symptom was a settings page stuck on "Loading your identity
 * provider configuration…". Two things had to be true for that: the page had no
 * error branch, AND something made the query neither resolve nor surface an
 * error quickly. The transport half is fixed in src/hooks/trpc.tsx (no retry on
 * 4xx; a request timeout so a hang becomes an error at all).
 *
 * This suite pins the server half — specifically the hypothesis named in the
 * issue, that the no-config-yet path might THROW rather than return null. It
 * does not, and these tests exist so it cannot start to: an org that has never
 * configured SSO is the state every first-time admin is in, and a throw there
 * is indistinguishable in the UI from a broken vault.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "@/server/trpc";
import { ssoRouter } from "@/server/routers/sso";
import { invalidateSessionIdentity, closeSessionIdentityRedis } from "@/server/lib/sessionIdentity";
import { nowSessionIssuedAt } from "@/server/lib/sessionPolicy";


const prisma = new PrismaClient();

function callerFor(userId: string, organizationId: string, role: Role) {
  return createCallerFactory(ssoRouter)({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: userId,
        email: "sso-config@test.dharma",
        name: "SSO Config Test",
        organizationId,
        role,
        sessionIssuedAt: nowSessionIssuedAt(),
      },
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;
let adminId: string;
let viewerId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `sso-cfg-${Date.now()}` } })).id;
  adminId = (
    await prisma.user.create({
      data: { email: `sso-admin-${Date.now()}@test.dharma`, organizationId: orgId, role: Role.ADMIN },
    })
  ).id;
  viewerId = (
    await prisma.user.create({
      data: { email: `sso-viewer-${Date.now()}@test.dharma`, organizationId: orgId, role: Role.VIEWER },
    })
  ).id;
  await Promise.all([invalidateSessionIdentity(adminId), invalidateSessionIdentity(viewerId)]);
});

afterAll(async () => {
  await prisma.organizationSettings.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("sso.getConfig — the empty state (a first-time admin)", () => {
  it("RESOLVES rather than throwing when the org has no settings row at all", async () => {
    // The issue's prime suspect. If this threw, every org that had never
    // touched SSO would see the failure UI on their first visit — and before
    // the page had an error branch, that rendered as the reported spinner.
    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();

    expect(result.ssoConfig).toBeNull();
    expect(result.ssoEnforced).toBe(false);
    expect(result.scimEnabled).toBe(false);
    expect(result.scimTokenSet).toBe(false);
  });

  it("still returns the callback URLs, so the setup form is usable before saving", async () => {
    // These are what an admin pastes into their IdP. Withholding them until a
    // config exists would make setup a chicken-and-egg problem.
    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();

    expect(result.urls.samlAcs).toContain(orgId);
    expect(result.urls.oidcRedirect).toContain(orgId);
    expect(result.urls.scimBase).toContain(orgId);
  });

  it("resolves the same way when a settings row exists but ssoConfig is unset", async () => {
    await prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId },
      update: { ssoConfig: undefined },
    });

    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();
    expect(result.ssoConfig).toBeNull();
  });
});

describe("sso.getConfig — the configured state", () => {
  it("returns SAML config with the certificate truncated", async () => {
    await prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        ssoConfig: {
          type: "SAML",
          entityId: "https://idp.example.com/entity",
          ssoUrl: "https://idp.example.com/sso",
          certificate: "A".repeat(200),
        },
      },
      update: {
        ssoConfig: {
          type: "SAML",
          entityId: "https://idp.example.com/entity",
          ssoUrl: "https://idp.example.com/sso",
          certificate: "A".repeat(200),
        },
      },
    });

    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();
    expect(result.ssoConfig).toMatchObject({ type: "SAML" });
    expect((result.ssoConfig as { certificate: string }).certificate.length).toBeLessThan(30);
  });

  it("NEVER returns the OIDC client secret, encrypted or otherwise", async () => {
    // A literal stand-in for the AES-256-GCM envelope rather than a real
    // encryptSsoSecret() call: that helper needs SSO_ENCRYPTION_KEY, which the
    // jest environment does not load (it lives in envs/.env.development). The
    // redaction under test is `delete config.clientSecretEnc` — it never
    // decrypts, so what the envelope actually contains is irrelevant to it, and
    // a fixture keeps this suite from failing for an unrelated reason.
    const enc = "v1:gcm:ZmFrZS1lbnZlbG9wZS1mb3ItcmVkYWN0aW9uLXRlc3Q=";
    await prisma.organizationSettings.update({
      where: { organizationId: orgId },
      data: {
        ssoConfig: {
          type: "OIDC",
          issuer: "https://login.example.com",
          clientId: "dharma-client",
          clientSecretEnc: enc,
        },
      },
    });

    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();
    const serialized = JSON.stringify(result);

    expect(result.ssoConfig).toMatchObject({ type: "OIDC", clientSecretSet: true });
    expect(serialized).not.toContain("super-secret-value");
    // The envelope too — it is decryptable by anything holding the KMS key, so
    // shipping it to a browser is not meaningfully better than plaintext.
    expect(serialized).not.toContain(enc);
  });

  it("returns null for a stored config that no longer parses, instead of throwing", async () => {
    // Corrupt/legacy JSON must degrade to "not configured" — a throw here would
    // reproduce the exact reported bug for an org that HAS configured SSO.
    await prisma.organizationSettings.update({
      where: { organizationId: orgId },
      data: { ssoConfig: { type: "SAML", entityId: "" } },
    });

    const result = await callerFor(adminId, orgId, Role.ADMIN).getConfig();
    expect(result.ssoConfig).toBeNull();
  });
});

describe("sso.getConfig — the error state", () => {
  it("refuses a caller without sso.configure, with FORBIDDEN and not a hang", async () => {
    // The page renders a distinct "you do not have access" branch off this
    // code. Asserting the CODE, not just that it rejected, is the point: the
    // UI's three branches key on it.
    await expect(callerFor(viewerId, orgId, Role.VIEWER).getConfig()).rejects.toBeInstanceOf(
      TRPCError,
    );
    await expect(callerFor(viewerId, orgId, Role.VIEWER).getConfig()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
