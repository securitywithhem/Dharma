/**
 * tests/aiIngestionWorker.test.ts — Phase 7 Part 1
 *
 * Two layers:
 *  1. Pure unit tests for the deterministic graph extractor (always run).
 *  2. Full-pipeline integration + TENANT-ISOLATION tests that require a live
 *     Postgres (with pgvector). These are DB-gated: if no database is
 *     reachable they log a warning and no-op, so `npm run test` stays green in
 *     environments without services. Run them against a migrated DB to execute
 *     the real assertions.
 *
 * The pipeline is driven synchronously via `processIngestionDocument` with
 * injected deps (fake MinIO bytes + deterministic embeddings + heuristic graph)
 * so it needs neither Redis, Ollama, nor MinIO — only Postgres.
 */
// Mock the queue module so importing the worker doesn't construct a real
// BullMQ Queue (which would open a Redis connection and hang the test run).
jest.mock("@/server/queue/aiIngestionQueue", () => ({
  AI_INGESTION_QUEUE_NAME: "ai-ingestion",
  aiIngestionQueue: { add: jest.fn() },
  enqueueAiIngestion: jest.fn(),
}));

import { PrismaClient, Role } from "@prisma/client";
// eslint-disable-next-line import/first
import { heuristicExtract, queryGraphNodesForOrg } from "@/server/ai/graphExtraction";
// eslint-disable-next-line import/first
import { processIngestionDocument } from "@/server/queue/workers/aiIngestionWorker";

const FIXTURE_TEXT = [
  "The Access Control Policy implements CC6.1 across all production systems.",
  "All administrators must use MFA when accessing the environment.",
  "The Incident Response Policy requires CC7.2 logging for every security event.",
  "Evidence of quarterly access reviews is retained for audit purposes.",
].join(" ");

const vec384 = () => Array.from({ length: 384 }, () => 0.05);
const testDeps = {
  getBuffer: async () => Buffer.from(FIXTURE_TEXT, "utf-8"),
  embedTexts: async (texts: string[]) => texts.map(() => vec384()),
  provider: null as null, // force deterministic heuristic graph extraction
};

describe("graphExtraction.heuristicExtract (pure)", () => {
  it("extracts control codes and named policies as nodes", () => {
    const g = heuristicExtract(FIXTURE_TEXT);
    const labels = g.nodes.map((n) => n.label);
    expect(labels.some((l) => l.includes("CC6.1"))).toBe(true);
    expect(labels.some((l) => /Policy$/.test(l))).toBe(true);
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  it("links a policy to a control mentioned in the same sentence", () => {
    const g = heuristicExtract("The Access Control Policy implements CC6.1.");
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges[0].relation === "implements" || g.edges[0].relation === "requires").toBe(true);
  });

  it("is deterministic and finds nothing in text without entities", () => {
    expect(heuristicExtract("This paragraph mentions no controls or policies.").nodes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration + tenant isolation
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();
let dbReady = false;

async function seedOrg(label: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  return { org, user };
}

describe("aiIngestionWorker — full pipeline + tenant isolation (DB-gated)", () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      dbReady = true;
    } catch {
      console.warn("[aiIngestionWorker.test] No database reachable — DB-gated tests skipped.");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  it("ingests a document end-to-end: COMPLETED, embeddings written, graph nodes > 0", async () => {
    if (!dbReady) return;
    const { org, user } = await seedOrg("worker-A");
    const doc = await prisma.ingestedDocument.create({
      data: {
        organizationId: org.id,
        uploadedById: user.id,
        filename: "policy.txt",
        mimeType: "text/plain",
        s3Key: `test/${doc_key()}`,
      },
      select: { id: true },
    });

    const result = await processIngestionDocument(prisma, doc.id, testDeps);

    expect(result.status).toBe("COMPLETED");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.graphNodeCount).toBeGreaterThan(0);

    const fresh = await prisma.ingestedDocument.findUnique({ where: { id: doc.id } });
    expect(fresh?.status).toBe("COMPLETED");
    expect(fresh?.chunkCount).toBe(result.chunkCount);

    const embeddings = await prisma.organizationEmbedding.findMany({ where: { sourceDocumentId: doc.id } });
    expect(embeddings.length).toBe(result.chunkCount);
    // Every embedding row is org-scoped and vector-populated.
    for (const e of embeddings) expect(e.organizationId).toBe(org.id);
    const withVec = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "OrganizationEmbedding" WHERE "sourceDocumentId" = $1 AND embedding IS NOT NULL`,
      doc.id,
    );
    expect(Number(withVec[0].n)).toBe(result.chunkCount);

    const nodes = await queryGraphNodesForOrg(prisma, org.id);
    expect(nodes.length).toBe(result.graphNodeCount);
  });

  it("keeps org B's data empty when org A ingests (cross-org isolation)", async () => {
    if (!dbReady) return;
    const a = await seedOrg("iso-A");
    const b = await seedOrg("iso-B");

    const docA = await prisma.ingestedDocument.create({
      data: {
        organizationId: a.org.id,
        uploadedById: a.user.id,
        filename: "a.txt",
        mimeType: "text/plain",
        s3Key: `test/${doc_key()}`,
      },
      select: { id: true },
    });
    await processIngestionDocument(prisma, docA.id, testDeps);

    // Org B sees NONE of org A's embeddings or graph nodes.
    const bEmbeddings = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "OrganizationEmbedding" WHERE "organizationId" = $1`,
      b.org.id,
    );
    expect(bEmbeddings).toHaveLength(0);

    const bNodes = await queryGraphNodesForOrg(prisma, b.org.id);
    expect(bNodes).toHaveLength(0);

    const bEdges = await prisma.orgGraphEdge.findMany({ where: { organizationId: b.org.id } });
    expect(bEdges).toHaveLength(0);

    // And org A's rows never carry org B's id.
    const leaked = await prisma.organizationEmbedding.count({
      where: { sourceDocumentId: docA.id, NOT: { organizationId: a.org.id } },
    });
    expect(leaked).toBe(0);
  });

  it("leaves no partial rows when the pipeline fails (idempotent cleanup)", async () => {
    if (!dbReady) return;
    const { org, user } = await seedOrg("fail-A");
    const doc = await prisma.ingestedDocument.create({
      data: {
        organizationId: org.id,
        uploadedById: user.id,
        filename: "boom.txt",
        mimeType: "text/plain",
        s3Key: `test/${doc_key()}`,
      },
      select: { id: true },
    });

    const failingDeps = {
      ...testDeps,
      embedTexts: async () => {
        throw new Error("simulated embedding outage");
      },
    };

    await expect(processIngestionDocument(prisma, doc.id, failingDeps)).rejects.toThrow();

    const fresh = await prisma.ingestedDocument.findUnique({ where: { id: doc.id } });
    expect(fresh?.status).toBe("FAILED");
    expect(fresh?.error).toContain("simulated embedding outage");
    const rows = await prisma.organizationEmbedding.count({ where: { sourceDocumentId: doc.id } });
    expect(rows).toBe(0);
    // Failure was recorded to the audit log.
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, action: "AI_INGESTION_FAILED", entityId: doc.id },
    });
    expect(audit).not.toBeNull();
  });
});

/** Unique-ish object key for fixture rows (no real MinIO object is created). */
function doc_key(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`;
}
