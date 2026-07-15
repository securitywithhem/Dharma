// Phase 9 Part 2 — report generation integration: report.create → worker →
// COMPLETED → PDF exists in MinIO, for BOTH report types, plus the empty-state
// (zero evidence/vulnerabilities must not throw) and org-scoping of
// report.create/get.
//
// MinIO is real (up in the test env) so we assert the object genuinely lands
// in storage via getObjectMetadata. The board-summary LLM is injected as a
// deterministic stub narrator (offline). report.create really enqueues to
// Redis (harmless — no worker runs here; we drive the processor directly).
// AUDIT_WRITER_MODE=sync makes audit writes inline.
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { createReportProcessor } from "@/server/queue/workers/reportWorker";
import { reportRouter } from "@/server/routers/report";
import { createTRPCRouter, createCallerFactory } from "@/server/trpc";
import { initializeMinIOBucket, getObjectMetadata } from "@/server/minio";
import type { Narrator } from "@/server/services/reportData";

const prisma = new PrismaClient();
const testRouter = createTRPCRouter({ report: reportRouter });

// Deterministic offline narrator — asserts the prompt is well-formed and
// returns a fixed narrative so the board path renders without an LLM.
const capturedPrompts: { systemPrompt: string; userContent: string }[] = [];
const stubNarrate: Narrator = async (systemPrompt, userContent) => {
  capturedPrompts.push({ systemPrompt, userContent });
  return {
    fullText:
      "The organization maintains a solid compliance posture.\n\n" +
      "Key risks stem from open vulnerabilities.\n\n" +
      "Recommendation: prioritize remediation.",
    usage: { promptTokens: 100, completionTokens: 60 },
  };
};

function caller(orgId: string, userId: string, role: Role = Role.ADMIN) {
  return createCallerFactory(testRouter)({
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

type Seed = { orgId: string; userId: string; frameworkId: string };

async function seedOrg(label: string, withData: boolean): Promise<Seed> {
  const org = await prisma.organization.create({
    data: { name: `${label} ${Date.now()}-${Math.random()}` },
  });
  const user = await prisma.user.create({
    data: { email: `${label}-${Date.now()}@t.test`, organizationId: org.id, role: Role.ADMIN },
  });
  const framework = await prisma.framework.create({
    data: { organizationId: org.id, name: `FW ${label}` },
  });
  const control = await prisma.control.create({
    data: { frameworkId: framework.id, domain: "D", title: "Encryption at rest", description: "x", status: "COMPLIANT" },
  });
  if (withData) {
    await prisma.evidence.create({
      data: { organizationId: org.id, controlId: control.id, fileName: "e.pdf", filePath: `${org.id}/e.pdf`, type: "API_RESPONSE", source: "agent" },
    });
    await prisma.vulnerability.create({
      data: { organizationId: org.id, controlId: control.id, title: "V", description: "d", severity: "MEDIUM", status: "OPEN" },
    });
  }
  return { orgId: org.id, userId: user.id, frameworkId: framework.id };
}

let orgA: Seed;
let orgEmpty: Seed;

beforeAll(async () => {
  await initializeMinIOBucket();
  orgA = await seedOrg("RepA", true);
  orgEmpty = await seedOrg("RepEmpty", false);
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgA.orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: orgEmpty.orgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

/** Confirms the object really exists in MinIO with non-trivial size. */
async function assertStoredPdf(objectKey: string) {
  const meta = await getObjectMetadata(objectKey);
  expect(meta.size).toBeGreaterThan(500);
}

describe("CUSTOM_PDF report", () => {
  it("create → worker renders a PDF into MinIO + COMPLETED + audit", async () => {
    const c = caller(orgA.orgId, orgA.userId);
    const { reportId, status } = await c.report.create({
      title: "Q3 report",
      config: {
        type: "CUSTOM_PDF",
        sections: ["framework_readiness", "evidence_status", "vulnerability_trend", "endpoint_compliance"],
      },
    });
    expect(status).toBe("QUEUED");
    // The row is queued for the worker.
    expect((await prisma.report.findUnique({ where: { id: reportId } }))?.status).toBe("QUEUED");

    await createReportProcessor(prisma)({ data: { reportId, organizationId: orgA.orgId } } as never);

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report?.status).toBe("COMPLETED");
    expect(report?.fileUrl).toBe(`${orgA.orgId}/reports/${reportId}.pdf`);
    await assertStoredPdf(report!.fileUrl!);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgA.orgId, action: "REPORT_GENERATED", entityId: reportId },
    });
    expect(audit).not.toBeNull();
  });

  it("get returns a presigned download URL once COMPLETED", async () => {
    const c = caller(orgA.orgId, orgA.userId);
    const { reportId } = await c.report.create({
      title: "R2",
      config: { type: "CUSTOM_PDF", sections: ["framework_readiness"] },
    });
    await createReportProcessor(prisma)({ data: { reportId, organizationId: orgA.orgId } } as never);
    const got = await c.report.get({ id: reportId });
    expect(got.status).toBe("COMPLETED");
    expect(got.downloadUrl).toBeTruthy();
  });
});

describe("BOARD_SUMMARY report", () => {
  it("builds the digest, narrates via the injected narrator, renders a PDF", async () => {
    capturedPrompts.length = 0;
    const c = caller(orgA.orgId, orgA.userId);
    const { reportId } = await c.report.create({ title: "Board brief", config: { type: "BOARD_SUMMARY" } });

    await createReportProcessor(prisma, { narrate: stubNarrate })(
      { data: { reportId, organizationId: orgA.orgId } } as never,
    );

    // The narrator saw a graph-facts-only prompt: system prompt constrains to
    // facts, and the user content must NOT contain raw evidence file names.
    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0].systemPrompt).toMatch(/ONLY the provided graph facts/i);
    expect(capturedPrompts[0].userContent).not.toContain("e.pdf");

    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report?.status).toBe("COMPLETED");
    await assertStoredPdf(report!.fileUrl!);
  });
});

describe("empty-state + isolation", () => {
  it("CUSTOM_PDF for an org with zero evidence/vulnerabilities does not throw", async () => {
    const c = caller(orgEmpty.orgId, orgEmpty.userId);
    const { reportId } = await c.report.create({
      title: "Empty report",
      config: {
        type: "CUSTOM_PDF",
        sections: ["evidence_status", "vulnerability_trend", "endpoint_compliance", "framework_readiness"],
      },
    });
    await createReportProcessor(prisma)({ data: { reportId, organizationId: orgEmpty.orgId } } as never);
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report?.status).toBe("COMPLETED");
    await assertStoredPdf(report!.fileUrl!);
  });

  it("BOARD_SUMMARY for an empty org still completes", async () => {
    const c = caller(orgEmpty.orgId, orgEmpty.userId);
    const { reportId } = await c.report.create({ title: "Empty board", config: { type: "BOARD_SUMMARY" } });
    await createReportProcessor(prisma, { narrate: stubNarrate })(
      { data: { reportId, organizationId: orgEmpty.orgId } } as never,
    );
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    expect(report?.status).toBe("COMPLETED");
  });

  it("report.create rejects a framework belonging to another org", async () => {
    const c = caller(orgEmpty.orgId, orgEmpty.userId);
    await expect(
      c.report.create({
        title: "Cross-org attempt",
        config: { type: "CUSTOM_PDF", sections: ["framework_readiness"], frameworkIds: [orgA.frameworkId] },
      }),
    ).rejects.toThrow(/do not belong/i);
  });

  it("report.get is org-scoped (other org gets NOT_FOUND)", async () => {
    const ca = caller(orgA.orgId, orgA.userId);
    const { reportId } = await ca.report.create({
      title: "A-only report",
      config: { type: "CUSTOM_PDF", sections: ["framework_readiness"] },
    });
    const cb = caller(orgEmpty.orgId, orgEmpty.userId);
    await expect(cb.report.get({ id: reportId })).rejects.toThrow();
  });
});
