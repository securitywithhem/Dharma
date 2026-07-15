// Phase 9 Part 2 — compliance graph digest builder: correct org-scoped
// nodes/edges and NO cross-org leakage. The digest is what the board-summary
// LLM narrates, so tenant isolation here is security-critical.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import {
  buildComplianceGraphDigest,
  digestToPromptFacts,
  graphDigestConfigHash,
} from "@/server/lib/graphify/complianceGraphBuilder";

const prisma = new PrismaClient();

type Seed = {
  orgId: string;
  frameworkId: string;
  controlId: string;
  evidenceId: string;
  vulnId: string;
  endpointId: string;
};

async function seedOrg(label: string): Promise<Seed> {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const framework = await prisma.framework.create({
    data: { organizationId: org.id, name: `FW ${label}` },
  });
  const control = await prisma.control.create({
    data: {
      frameworkId: framework.id,
      domain: "Cryptography",
      title: `Encryption control ${label}`,
      description: "desc",
      status: "COMPLIANT",
    },
  });
  const evidence = await prisma.evidence.create({
    data: {
      organizationId: org.id,
      controlId: control.id,
      fileName: `secret-${label}.pdf`,
      filePath: `${org.id}/x.pdf`,
      type: "API_RESPONSE",
      source: "agent",
    },
  });
  const vuln = await prisma.vulnerability.create({
    data: {
      organizationId: org.id,
      controlId: control.id,
      title: `Vuln ${label}`,
      description: "vuln desc",
      severity: "HIGH",
      status: "OPEN",
    },
  });
  const endpoint = await prisma.endpoint.create({
    data: {
      organizationId: org.id,
      hostname: `host-${label}`,
      os: "macOS",
      osVersion: "14",
      agentVersion: "0.1.0",
      enrollmentTokenHash: `hash-${label}-${Date.now()}`,
      status: "ACTIVE",
    },
  });
  await prisma.endpointCheck.create({
    data: {
      endpointId: endpoint.id,
      organizationId: org.id,
      checkType: "disk_encryption",
      result: { pass: true },
      controlId: control.id,
    },
  });
  return {
    orgId: org.id,
    frameworkId: framework.id,
    controlId: control.id,
    evidenceId: evidence.id,
    vulnId: vuln.id,
    endpointId: endpoint.id,
  };
}

let orgA: Seed;
let orgB: Seed;

beforeAll(async () => {
  orgA = await seedOrg("GraphA");
  orgB = await seedOrg("GraphB");
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgA.orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgB.orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("buildComplianceGraphDigest", () => {
  it("produces org-scoped nodes and edges with correct relations", async () => {
    const digest = await buildComplianceGraphDigest(prisma, orgA.orgId);

    expect(digest.organizationId).toBe(orgA.orgId);
    expect(digest.counts).toMatchObject({
      frameworks: 1,
      controls: 1,
      evidence: 1,
      vulnerabilities: 1,
      endpoints: 1,
    });

    const nodeIds = new Set(digest.nodes.map((n) => n.id));
    expect(nodeIds.has(`ctl:${orgA.controlId}`)).toBe(true);
    expect(nodeIds.has(`ev:${orgA.evidenceId}`)).toBe(true);
    expect(nodeIds.has(`vln:${orgA.vulnId}`)).toBe(true);
    expect(nodeIds.has(`ep:${orgA.endpointId}`)).toBe(true);

    const rel = (r: string) => digest.edges.filter((e) => e.relation === r);
    expect(rel("supports")).toContainEqual({ from: `ev:${orgA.evidenceId}`, to: `ctl:${orgA.controlId}`, relation: "supports" });
    expect(rel("affects")).toContainEqual({ from: `vln:${orgA.vulnId}`, to: `ctl:${orgA.controlId}`, relation: "affects" });
    expect(rel("attests")).toContainEqual({ from: `ep:${orgA.endpointId}`, to: `ctl:${orgA.controlId}`, relation: "attests" });
  });

  it("NEVER leaks another org's entities (tenant isolation)", async () => {
    const digest = await buildComplianceGraphDigest(prisma, orgA.orgId);
    const serialized = JSON.stringify(digest);

    // None of org B's ids may appear anywhere in org A's digest.
    for (const id of [orgB.controlId, orgB.evidenceId, orgB.vulnId, orgB.endpointId, orgB.frameworkId]) {
      expect(serialized).not.toContain(id);
    }
  });

  it("digestToPromptFacts emits aggregates only — never raw evidence file contents", async () => {
    const digest = await buildComplianceGraphDigest(prisma, orgA.orgId);
    const facts = digestToPromptFacts(digest);

    expect(facts).toContain("1 controls have supporting evidence.");
    expect(facts).toMatch(/vulnerabilities by severity: 1 HIGH/);
    // The fact list must not carry the evidence file name (a proxy for "no
    // raw contents / labels leak into the prompt").
    expect(facts).not.toContain("secret-GraphA.pdf");
  });

  it("config hash is stable and order-independent for framework filters", () => {
    const a = graphDigestConfigHash({ frameworkIds: ["f1", "f2"] });
    const b = graphDigestConfigHash({ frameworkIds: ["f2", "f1"] });
    expect(a).toBe(b);
    expect(graphDigestConfigHash({ frameworkIds: ["f3"] })).not.toBe(a);
  });

  it("empty org yields an empty but well-formed digest (no throw)", async () => {
    const empty = await prisma.organization.create({
      data: { name: `GraphEmpty ${Date.now()}-${Math.random()}` },
    });
    const digest = await buildComplianceGraphDigest(prisma, empty.id);
    expect(digest.nodes).toEqual([]);
    expect(digest.edges).toEqual([]);
    expect(digest.counts.controls).toBe(0);
    expect(() => digestToPromptFacts(digest)).not.toThrow();
    await prisma.organization.delete({ where: { id: empty.id } }).catch(() => undefined);
  });
});
