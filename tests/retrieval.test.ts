/**
 * tests/retrieval.test.ts — Phase 7 Part 2 hybrid retrieval tests.
 *
 * Runnable (no services): asserts the raw pgvector query is org-scoped and
 * fully parameterized — a regression guard that FAILS if the
 * `WHERE "organizationId" = ${orgId}` clause is removed or the values are
 * string-concatenated. Plus mapping / live-control logic via a fake Prisma.
 *
 * DB-gated: real two-org isolation against seeded pgvector rows.
 */
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { retrieveContext } from "@/server/ai/retrieval";

const vec = () => Array.from({ length: 384 }, () => 0.05);

/** Minimal fake Prisma that records the Prisma.Sql passed to $queryRaw. */
function makeFakePrisma(rows: unknown[], opts: { frameworks?: any[]; controls?: any[]; mappings?: any[]; edges?: any[] } = {}) {
  const captured: { sql?: Prisma.Sql } = {};
  const prisma = {
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
      captured.sql = sql;
      return rows;
    }),
    orgGraphEdge: { findMany: jest.fn(async () => opts.edges ?? []) },
    framework: { findMany: jest.fn(async () => opts.frameworks ?? []) },
    control: { findMany: jest.fn(async () => opts.controls ?? []) },
    controlMapping: { findMany: jest.fn(async () => opts.mappings ?? []) },
    ingestedDocument: { findMany: jest.fn(async () => (opts as any).documents ?? []) },
  };
  return { prisma, captured };
}

describe("retrieveContext — parameterized org scoping (regression guard)", () => {
  it("scopes the pgvector query to organizationId as a bound parameter", async () => {
    const orgId = "org_ABC";
    const { prisma, captured } = makeFakePrisma([]);
    await retrieveContext(prisma as unknown as PrismaClient, orgId, "any question", { embedQuery: async () => vec() });

    expect(captured.sql).toBeDefined();
    const strings = captured.sql!.strings.join(" ");
    // The org filter clause is present in the static SQL...
    expect(strings).toMatch(/"organizationId"\s*=/);
    // ...and orgId is passed as a VALUE (parameterized), never concatenated.
    expect(captured.sql!.values).toContain(orgId);
    expect(strings).not.toContain(orgId);
  });

  it("maps rows to ScoredChunks and extracts graphNodeId from metadata", async () => {
    const rows = [
      { id: "e1", content: "MFA enforced", chunkIndex: 0, documentType: "policy_doc", documentId: "d1", sourceDocumentId: "d1", metadata: { graphNodeId: "n1" }, distance: 0.12 },
      { id: "e2", content: "Backups run daily", chunkIndex: 1, documentType: "policy_doc", documentId: "d1", sourceDocumentId: "d1", metadata: null, distance: 0.2 },
    ];
    const { prisma } = makeFakePrisma(rows);
    const result = await retrieveContext(prisma as unknown as PrismaClient, "org1", "q", { embedQuery: async () => vec() });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toMatchObject({ id: "e1", distance: 0.12, graphNodeId: "n1" });
    expect(result.chunks[1].graphNodeId).toBeNull();
  });

  it("pulls live controls when the query names an org framework (Phase 6 dependency)", async () => {
    const { prisma } = makeFakePrisma([], {
      frameworks: [{ id: "f1", name: "SOC 2" }],
      controls: [{ id: "c1", code: "CC6.1", title: "Logical access", status: "COMPLIANT", domain: "Access", frameworkId: "f1" }],
      mappings: [{ sourceControlId: "c1", targetControl: { code: "A.9.2.1", title: "User registration" } }],
    });
    const result = await retrieveContext(prisma as unknown as PrismaClient, "org1", "gap analysis against SOC 2", {
      embedQuery: async () => vec(),
    });
    expect(result.liveControls).toHaveLength(1);
    expect(result.liveControls[0]).toMatchObject({ controlId: "c1", code: "CC6.1", status: "COMPLIANT", frameworkName: "SOC 2" });
    expect(result.liveControls[0].mappedTo).toContain("A.9.2.1");
  });

  it("returns no live controls when the query names no framework", async () => {
    const { prisma } = makeFakePrisma([], { frameworks: [{ id: "f1", name: "SOC 2" }] });
    const result = await retrieveContext(prisma as unknown as PrismaClient, "org1", "what is our encryption posture", {
      embedQuery: async () => vec(),
    });
    expect(result.liveControls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DB-gated real tenant isolation
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();
let dbReady = false;

async function seedOrgWithEmbedding(label: string, content: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@t.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  const doc = await prisma.ingestedDocument.create({
    data: { organizationId: org.id, uploadedById: user.id, filename: "f.txt", mimeType: "text/plain", s3Key: `k-${stamp}` },
    select: { id: true },
  });
  const emb = await prisma.organizationEmbedding.create({
    data: { organizationId: org.id, documentType: "policy_doc", documentId: doc.id, sourceDocumentId: doc.id, chunkIndex: 0, content },
    select: { id: true },
  });
  await prisma.$executeRawUnsafe(`UPDATE "OrganizationEmbedding" SET embedding = $1::vector WHERE id = $2`, `[${vec().join(",")}]`, emb.id);
  return { org, embeddingId: emb.id };
}

describe("retrieveContext — real tenant isolation (DB-gated)", () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      dbReady = true;
    } catch {
      console.warn("[retrieval.test] No database reachable — DB-gated tests skipped.");
    }
  });
  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  it("never returns org A's chunks when querying as org B", async () => {
    if (!dbReady) return;
    const a = await seedOrgWithEmbedding("ret-A", "ORG A SECRET compliance content");
    const b = await seedOrgWithEmbedding("ret-B", "ORG B compliance content");

    const resB = await retrieveContext(prisma, b.org.id, "compliance", { embedQuery: async () => vec(), topK: 50 });
    const ids = resB.chunks.map((c) => c.id);
    expect(ids).toContain(b.embeddingId);
    expect(ids).not.toContain(a.embeddingId);
    for (const c of resB.chunks) expect(c.content).not.toContain("ORG A SECRET");

    // Querying as a non-owner org id returns zero of A's rows.
    const resWrong = await retrieveContext(prisma, b.org.id, "secret", { embedQuery: async () => vec(), topK: 50 });
    expect(resWrong.chunks.find((c) => c.id === a.embeddingId)).toBeUndefined();
  });
});
