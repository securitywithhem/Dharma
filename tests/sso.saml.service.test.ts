// Phase 8 Part 1 — SAML service tests against REAL signature validation:
// a throwaway IdP key/cert signs genuine assertions, then we assert the
// validator accepts the honest one and rejects tampered / unsigned /
// expired / stale / cross-org responses.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import {
  parseIdpMetadata,
  validateMetadata,
  handleSamlCallback,
  samlSpEntityId,
  samlCallbackUrl,
  SamlConfigError,
  SamlValidationError,
} from "@/server/services/sso/saml.service";
import {
  generateIdpKeys,
  certBody,
  buildSamlResponseXml,
  toSamlResponseParam,
  buildIdpMetadataXml,
  type TestIdpKeys,
} from "./helpers/samlTestIdp";

const prisma = new PrismaClient();
const IDP_ENTITY_ID = "https://idp.test/saml";
const IDP_SSO_URL = "https://idp.test/saml/sso";

async function seedOrgWithSaml(label: string, keys: TestIdpKeys) {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  await prisma.organizationSettings.create({
    data: {
      organizationId: org.id,
      ssoConfig: {
        type: "SAML",
        entityId: IDP_ENTITY_ID,
        ssoUrl: IDP_SSO_URL,
        certificate: certBody(keys.certificate),
      },
    },
  });
  return org;
}

function signedResponseFor(
  orgId: string,
  keys: TestIdpKeys,
  overrides: Partial<Parameters<typeof buildSamlResponseXml>[0]> = {},
) {
  return buildSamlResponseXml({
    idpEntityId: IDP_ENTITY_ID,
    audience: samlSpEntityId(orgId),
    acsUrl: samlCallbackUrl(orgId),
    nameId: "alice@enterprise.test",
    email: "alice@enterprise.test",
    displayName: "Alice Example",
    keys,
    ...overrides,
  });
}

describe("SAML metadata parsing", () => {
  const keys = generateIdpKeys();

  it("extracts entityId, SSO URL and signing cert from IdP metadata", () => {
    const xml = buildIdpMetadataXml(IDP_ENTITY_ID, IDP_SSO_URL, keys);
    const parsed = parseIdpMetadata(xml);
    expect(parsed.entityId).toBe(IDP_ENTITY_ID);
    expect(parsed.ssoUrl).toBe(IDP_SSO_URL);
    expect(parsed.certificate).toBe(certBody(keys.certificate));
  });

  it("rejects metadata without a signing certificate", () => {
    const xml =
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x">` +
      `<md:IDPSSODescriptor><md:SingleSignOnService Binding="b" Location="https://x/sso"/></md:IDPSSODescriptor>` +
      `</md:EntityDescriptor>`;
    expect(() => parseIdpMetadata(xml)).toThrow(SamlConfigError);
  });

  it("rejects SP metadata (no IDPSSODescriptor)", () => {
    const xml =
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x">` +
      `<md:SPSSODescriptor/></md:EntityDescriptor>`;
    expect(() => parseIdpMetadata(xml)).toThrow(/IDPSSODescriptor/);
  });

  it("refuses cleartext http metadata URLs", async () => {
    await expect(validateMetadata("http://idp.test/metadata")).rejects.toThrow(
      /https/,
    );
  });
});

describe("SAML callback validation (real signatures)", () => {
  const keys = generateIdpKeys();
  const wrongKeys = generateIdpKeys();
  let orgId: string;
  let otherOrgId: string;
  const cleanupOrgIds: string[] = [];

  beforeAll(async () => {
    const org = await seedOrgWithSaml("SamlOrgA", keys);
    const other = await seedOrgWithSaml("SamlOrgB", wrongKeys);
    orgId = org.id;
    otherOrgId = other.id;
    cleanupOrgIds.push(org.id, other.id);
  });

  afterAll(async () => {
    for (const id of cleanupOrgIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("accepts a validly signed assertion, JIT-provisions a VIEWER, and audit-logs SSO_LOGIN", async () => {
    const xml = signedResponseFor(orgId, keys);
    const user = await handleSamlCallback(prisma, orgId, toSamlResponseParam(xml));

    expect(user.email).toBe("alice@enterprise.test");
    expect(user.organizationId).toBe(orgId);
    expect(user.role).toBe(Role.VIEWER);
    expect(user.name).toBe("Alice Example");

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "SSO_LOGIN", entityId: user.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a tampered assertion (attribute modified after signing)", async () => {
    const xml = signedResponseFor(orgId, keys, {
      nameId: "victim@enterprise.test",
      email: "victim@enterprise.test",
    });
    const tampered = xml.replace(
      "victim@enterprise.test",
      "attacker@enterprise.test",
    );
    expect(tampered).not.toBe(xml);

    await expect(
      handleSamlCallback(prisma, orgId, toSamlResponseParam(tampered)),
    ).rejects.toThrow(SamlValidationError);

    const created = await prisma.user.findFirst({
      where: { email: { in: ["attacker@enterprise.test", "victim@enterprise.test"] } },
    });
    expect(created).toBeNull();
  });

  it("rejects an unsigned assertion", async () => {
    const xml = signedResponseFor(orgId, keys, { sign: false });
    await expect(
      handleSamlCallback(prisma, orgId, toSamlResponseParam(xml)),
    ).rejects.toThrow(SamlValidationError);
  });

  it("rejects an expired assertion", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const xml = signedResponseFor(orgId, keys, {
      issueInstant: new Date(past.getTime() - 5 * 60 * 1000),
      notOnOrAfter: past,
    });
    await expect(
      handleSamlCallback(prisma, orgId, toSamlResponseParam(xml)),
    ).rejects.toThrow(SamlValidationError);
  });

  it("rejects a stale assertion older than the max assertion age even when NotOnOrAfter is generous", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const xml = signedResponseFor(orgId, keys, {
      issueInstant: tenMinutesAgo,
      notOnOrAfter: new Date(Date.now() + 60 * 60 * 1000),
    });
    await expect(
      handleSamlCallback(prisma, orgId, toSamlResponseParam(xml)),
    ).rejects.toThrow(SamlValidationError);
  });

  it("tenant isolation: org A's signed response does not validate under org B", async () => {
    // Signed with org A's IdP key; org B pins a different cert.
    const xml = signedResponseFor(otherOrgId, keys);
    await expect(
      handleSamlCallback(prisma, otherOrgId, toSamlResponseParam(xml)),
    ).rejects.toThrow(SamlValidationError);
  });

  it("tenant isolation: a valid assertion cannot claim an email belonging to another org's user", async () => {
    const foreign = await prisma.user.create({
      data: {
        email: `foreign-${Date.now()}@elsewhere.test`,
        organizationId: otherOrgId,
        role: Role.ADMIN,
      },
    });
    const xml = signedResponseFor(orgId, keys, {
      nameId: foreign.email,
      email: foreign.email,
    });
    await expect(
      handleSamlCallback(prisma, orgId, toSamlResponseParam(xml)),
    ).rejects.toThrow(/different workspace/);

    const untouched = await prisma.user.findUnique({ where: { id: foreign.id } });
    expect(untouched?.organizationId).toBe(otherOrgId);
  });

  it("rejects garbage input outright", async () => {
    await expect(
      handleSamlCallback(prisma, orgId, Buffer.from("<not-saml/>").toString("base64")),
    ).rejects.toThrow(SamlValidationError);
  });
});
