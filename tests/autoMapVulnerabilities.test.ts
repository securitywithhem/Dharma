import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, PenTestStatus, PenTestType, Role } from "@prisma/client";

jest.mock("@/workers/ollama", () => ({
  getEmbedding: jest.fn(() => Promise.resolve(new Array(384).fill(0.01))),
}));

// eslint-disable-next-line import/first
import { autoMapVulnerabilities } from "@/server/pentest/autoMapVulnerabilities";
// eslint-disable-next-line import/first
import type { NucleiFinding } from "@/server/pentest/scanner";

const prisma = new PrismaClient();

async function seedOrg(label: string) {
  const org = await prisma.organization.create({ data: { name: `${label} ${Date.now()}-${Math.random()}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${Date.now()}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  // WAVE 12 — a PenTest cannot exist without the authorization it ran under.
  const verifiedAsset = await prisma.verifiedAsset.create({
    data: {
      organizationId: org.id,
      value: "example.com",
      verificationToken: `${label}-token`,
      requestedById: user.id,
      verifiedById: user.id,
      verifiedAt: new Date(),
    },
  });
  const penTest = await prisma.penTest.create({
    data: {
      organizationId: org.id,
      target: "example.com",
      type: PenTestType.EXTERNAL_NETWORK,
      status: PenTestStatus.COMPLETED,
      requestedById: user.id,
      verifiedAssetId: verifiedAsset.id,
    },
  });
  return { org, user, penTest, verifiedAsset };
}

const sampleFindings: NucleiFinding[] = [
  {
    templateId: "tls-version",
    name: "Deprecated TLS Version Detected",
    severity: "medium",
    host: "example.com",
    matchedAt: "example.com:443",
    description: "TLS 1.0/1.1 supported.",
    raw: { info: { severity: "medium", classification: { "cvss-score": 5.3 } } },
  },
];

describe("autoMapVulnerabilities", () => {
  let seeded: Awaited<ReturnType<typeof seedOrg>>;

  beforeAll(async () => {
    seeded = await seedOrg("AutoMapOrg");
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: seeded.org.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("auto-links to the org's 'Vulnerability Management' control when one exists", async () => {
    const framework = await prisma.framework.create({
      data: { organizationId: seeded.org.id, name: `Framework ${Date.now()}` },
    });
    const control = await prisma.control.create({
      data: {
        frameworkId: framework.id,
        domain: "Security",
        title: "Vulnerability Management",
        description: "Test control",
      },
    });

    const created = await autoMapVulnerabilities(prisma, sampleFindings, seeded.penTest.id, seeded.org.id);
    expect(created).toBe(1);

    const rows = await prisma.vulnerability.findMany({ where: { penTestId: seeded.penTest.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].controlId).toBe(control.id);
    expect(rows[0].title).toBe("Deprecated TLS Version Detected");
  });

  it("gracefully leaves controlId null when no 'Vulnerability Management' control exists", async () => {
    const orgNoControl = await seedOrg("AutoMapOrgNoControl");

    const created = await autoMapVulnerabilities(
      prisma,
      sampleFindings,
      orgNoControl.penTest.id,
      orgNoControl.org.id,
    );
    expect(created).toBe(1);

    const rows = await prisma.vulnerability.findMany({ where: { penTestId: orgNoControl.penTest.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].controlId).toBeNull();

    await prisma.organization.delete({ where: { id: orgNoControl.org.id } }).catch(() => undefined);
  });

  it("returns 0 and creates nothing for an empty findings list", async () => {
    const created = await autoMapVulnerabilities(prisma, [], seeded.penTest.id, seeded.org.id);
    expect(created).toBe(0);
  });
});
