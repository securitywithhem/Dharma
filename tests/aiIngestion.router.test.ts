/**
 * tests/aiIngestion.router.test.ts — Phase 7 Part 1
 *
 * tRPC router tests for aiIngestionRouter. The BullMQ queue and MinIO client
 * are mocked so no Redis/MinIO is needed; the auth-guard test runs with no
 * services at all. The remaining tests are DB-gated (need Postgres) and no-op
 * with a clear warning when no database is reachable.
 */
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";

// Avoid opening a real Redis connection / MinIO calls from the router.
jest.mock("@/server/queue/aiIngestionQueue", () => ({
  enqueueAiIngestion: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/storage/minioClient", () => ({
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/first
import { aiIngestionRouter } from "@/server/routers/aiIngestion";
// eslint-disable-next-line import/first
import { enqueueAiIngestion } from "@/server/queue/aiIngestionQueue";

const testRouter = createTRPCRouter({ aiIngestion: aiIngestionRouter });
const prisma = new PrismaClient();
let dbReady = false;

function createCaller(orgId: string | null, uid: string, role: Role = Role.ADMIN) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: orgId
      ? {
          user: { id: uid, email: `${uid}@example.com`, name: "T", organizationId: orgId, role },
          expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        }
      : null,
    isAuditor: false,
    auditorTokenExpiry: undefined,
  } as never);
}

async function seedOrg(label: string) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const org = await prisma.organization.create({ data: { name: `${label} ${stamp}` } });
  const user = await prisma.user.create({
    data: { email: `${label}-${stamp}@test.com`, name: label, role: Role.ADMIN, organizationId: org.id },
  });
  return { org, user };
}

describe("aiIngestionRouter", () => {
  beforeAll(async () => {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      dbReady = true;
    } catch {
      console.warn("[aiIngestion.router.test] No database reachable — DB-gated tests skipped.");
    }
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => {});
  });

  it("rejects unauthenticated calls (no services needed)", async () => {
    const caller = createCaller(null, "nobody");
    await expect(
      caller.aiIngestion.uploadDocument({ filename: "x.txt", mimeType: "text/plain", s3Key: "k" }),
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.aiIngestion.listIngestedDocuments({})).rejects.toBeInstanceOf(TRPCError);
  });

  it("uploadDocument creates a PENDING doc and enqueues the pipeline", async () => {
    if (!dbReady) return;
    const { org, user } = await seedOrg("router-A");
    const caller = createCaller(org.id, user.id);

    const { documentId } = await caller.aiIngestion.uploadDocument({
      filename: "policy.pdf",
      mimeType: "application/pdf",
      s3Key: "uploads/policy.pdf",
    });
    expect(documentId).toBeTruthy();
    expect(enqueueAiIngestion).toHaveBeenCalledWith(documentId);

    const row = await prisma.ingestedDocument.findUnique({ where: { id: documentId } });
    expect(row?.status).toBe("PENDING");
    expect(row?.organizationId).toBe(org.id);

    const status = await caller.aiIngestion.getDocumentStatus({ documentId });
    expect(status.status).toBe("PENDING");
  });

  it("org-scopes access: org B cannot read org A's document", async () => {
    if (!dbReady) return;
    const a = await seedOrg("scope-A");
    const b = await seedOrg("scope-B");
    const callerA = createCaller(a.org.id, a.user.id);
    const callerB = createCaller(b.org.id, b.user.id);

    const { documentId } = await callerA.aiIngestion.uploadDocument({
      filename: "secret.txt",
      mimeType: "text/plain",
      s3Key: "uploads/secret.txt",
    });

    await expect(callerB.aiIngestion.getDocumentStatus({ documentId })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Org B's list must not include org A's document.
    const listB = await callerB.aiIngestion.listIngestedDocuments({});
    expect(listB.items.find((d) => d.id === documentId)).toBeUndefined();
  });

  it("deleteIngestedDocument removes the doc and cascades its embeddings", async () => {
    if (!dbReady) return;
    const { org, user } = await seedOrg("del-A");
    const caller = createCaller(org.id, user.id);
    const { documentId } = await caller.aiIngestion.uploadDocument({
      filename: "d.txt",
      mimeType: "text/plain",
      s3Key: "uploads/d.txt",
    });
    // Seed a derived embedding row to prove the cascade.
    await prisma.organizationEmbedding.create({
      data: {
        organizationId: org.id,
        documentType: "policy_doc",
        documentId,
        sourceDocumentId: documentId,
        chunkIndex: 0,
        content: "chunk",
      },
    });

    await caller.aiIngestion.deleteIngestedDocument({ documentId });

    expect(await prisma.ingestedDocument.findUnique({ where: { id: documentId } })).toBeNull();
    expect(await prisma.organizationEmbedding.count({ where: { sourceDocumentId: documentId } })).toBe(0);
  });

  it("org B cannot delete org A's document", async () => {
    if (!dbReady) return;
    const a = await seedOrg("deliso-A");
    const b = await seedOrg("deliso-B");
    const callerA = createCaller(a.org.id, a.user.id);
    const callerB = createCaller(b.org.id, b.user.id);
    const { documentId } = await callerA.aiIngestion.uploadDocument({
      filename: "keep.txt",
      mimeType: "text/plain",
      s3Key: "uploads/keep.txt",
    });

    await expect(callerB.aiIngestion.deleteIngestedDocument({ documentId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await prisma.ingestedDocument.findUnique({ where: { id: documentId } })).not.toBeNull();
  });
});
