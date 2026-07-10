import { ConnectorStatus, ControlStatus, EvidenceType } from "@prisma/client";

// ------------------------------------------------------------------
// Mocks
//
// jest.mock() factories are hoisted above regular const declarations
// (including the `import` line above), so the mock Prisma object must be
// built entirely inside the factory rather than closed over from an outer
// variable — referencing an outer const here would throw a TDZ
// ReferenceError since the factory runs before that const initializes.
// ------------------------------------------------------------------

jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client");
  const mockPrismaInstance = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ locked: true }]);
      }
      return Promise.resolve([]); // pg_advisory_unlock
    }),
    evidenceMapping: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    evidence: {
      create: jest.fn(),
    },
    control: {
      update: jest.fn(),
    },
    connector: {
      update: jest.fn(),
    },
  };
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrismaInstance),
  };
});

// Retrieve the same mock instance the worker's `new PrismaClient()` receives
// — calling the mocked constructor again returns the same object because the
// mock factory function always returns mockPrismaInstance.
const { PrismaClient: MockedPrismaClient } = jest.requireMock("@prisma/client") as {
  PrismaClient: new () => any;
};
const mockPrisma = new MockedPrismaClient();

jest.mock("@/server/connectors/registry", () => ({
  getConnectorAdapter: jest.fn(),
}));

jest.mock("@/server/lib/crypto/connectorVault", () => ({
  decryptConnectorConfig: jest.fn(() => ({ roleArn: "arn:aws:iam::123:role/x", externalId: "ext" })),
}));

jest.mock("@/server/audit-log", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/server/connectors/notify", () => ({
  notifyEvidenceUpdated: jest.fn().mockResolvedValue(undefined),
  notifyControlFailed: jest.fn().mockResolvedValue(undefined),
}));

// Prevent the real BullMQ Queue (and its Redis connection) from being
// constructed as an import side effect of connectorQueue.ts — the worker
// module only needs the constant/type from it, not a live connection.
jest.mock("@/server/queue/connectorQueue", () => ({
  CONNECTOR_EVIDENCE_QUEUE_NAME: "connector-evidence-collection",
}));

import { processConnectorEvidenceJob } from "@/server/queue/workers/connectorEvidenceWorker";
import { getConnectorAdapter } from "@/server/connectors/registry";
import { createAuditLog } from "@/server/audit-log";
import { notifyEvidenceUpdated, notifyControlFailed } from "@/server/connectors/notify";

function baseMapping(overrides: Partial<any> = {}) {
  const { connector: connectorOverride, control: controlOverride, ...rest } = overrides;
  return {
    id: "mapping-1",
    connectorId: "connector-1",
    controlId: "control-1",
    evidenceType: "aws_cloudtrail_enabled",
    schedule: "0 3 * * *",
    lastCollectedAt: null,
    createdAt: new Date(),
    connector: {
      id: "connector-1",
      organizationId: "org-1",
      type: "AWS",
      config: "encrypted-blob",
      status: ConnectorStatus.CONNECTED,
      ...connectorOverride,
    },
    control: {
      id: "control-1",
      status: ControlStatus.NOT_STARTED,
      framework: { organizationId: "org-1" },
      ...controlOverride,
    },
    ...rest,
  };
}

function fakeJob(data: { evidenceMappingId: string; manual?: boolean }) {
  return { id: "job-1", data } as any;
}

describe("processConnectorEvidenceJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ locked: true }]);
      }
      return Promise.resolve([]);
    });
  });

  it("persists auto-collected evidence, marks source='auto', and derives COMPLIANT on all-pass", async () => {
    const mapping = baseMapping();
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);
    mockPrisma.evidence.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "evidence-1", ...data }),
    );

    const collectEvidence = jest.fn().mockResolvedValue([
      {
        id: "cloudtrail-1",
        type: "aws_cloudtrail_enabled",
        fileName: "trail-status.json",
        summary: "CloudTrail logging enabled",
        collectedAt: new Date(),
        status: "pass",
      },
    ]);
    (getConnectorAdapter as jest.Mock).mockReturnValue({ collectEvidence });

    const result = await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(result).toEqual({ status: "collected", evidenceCreated: 1 });
    expect(mockPrisma.evidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "auto",
          controlId: "control-1",
          connectorId: "connector-1",
          evidenceMappingId: "mapping-1",
          type: EvidenceType.API_RESPONSE,
        }),
      }),
    );
    expect(mockPrisma.control.update).toHaveBeenCalledWith({
      where: { id: "control-1" },
      data: { status: ControlStatus.COMPLIANT },
    });
    expect(mockPrisma.evidenceMapping.update).toHaveBeenCalledWith({
      where: { id: "mapping-1" },
      data: { lastCollectedAt: expect.any(Date) },
    });
    expect(mockPrisma.connector.update).toHaveBeenCalledWith({
      where: { id: "connector-1" },
      data: { lastSyncAt: expect.any(Date), status: ConnectorStatus.CONNECTED, lastError: null },
    });
    expect(notifyEvidenceUpdated).toHaveBeenCalledWith(
      mockPrisma,
      "org-1",
      "control-1",
      expect.objectContaining({ id: "evidence-1", evidenceType: "aws_cloudtrail_enabled", status: "pass" }),
    );
    expect(notifyControlFailed).not.toHaveBeenCalled();
  });

  it("downgrades control status to IN_PROGRESS when any collected item fails, and fires notifyControlFailed once", async () => {
    const mapping = baseMapping({ control: { status: ControlStatus.COMPLIANT } });
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);
    mockPrisma.evidence.create.mockResolvedValue({ id: "evidence-1" });

    const collectEvidence = jest.fn().mockResolvedValue([
      { id: "x", type: "aws_cloudtrail_enabled", fileName: "a.json", collectedAt: new Date(), status: "fail" },
    ]);
    (getConnectorAdapter as jest.Mock).mockReturnValue({ collectEvidence });

    await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(mockPrisma.control.update).toHaveBeenCalledWith({
      where: { id: "control-1" },
      data: { status: ControlStatus.IN_PROGRESS },
    });
    expect(notifyControlFailed).toHaveBeenCalledWith(mockPrisma, "org-1", "control-1");
    expect(notifyControlFailed).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-fire notifyControlFailed when a control is already failing and fails again", async () => {
    // Control is already IN_PROGRESS (our stand-in for "failing") — a repeat
    // failing run must not re-fire control.failed, since nextStatus equals
    // the current status and the worker's status-transition block is skipped.
    const mapping = baseMapping({ control: { status: ControlStatus.IN_PROGRESS } });
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);
    mockPrisma.evidence.create.mockResolvedValue({ id: "evidence-1" });

    const collectEvidence = jest.fn().mockResolvedValue([
      { id: "x", type: "aws_cloudtrail_enabled", fileName: "a.json", collectedAt: new Date(), status: "fail" },
    ]);
    (getConnectorAdapter as jest.Mock).mockReturnValue({ collectEvidence });

    await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(mockPrisma.control.update).not.toHaveBeenCalled();
    expect(notifyControlFailed).not.toHaveBeenCalled();
  });

  it("sets Connector.status=ERROR and rethrows without crashing on adapter failure", async () => {
    const mapping = baseMapping();
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);

    const collectEvidence = jest.fn().mockRejectedValue(new Error("STS assume-role failed"));
    (getConnectorAdapter as jest.Mock).mockReturnValue({ collectEvidence });

    await expect(
      processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" })),
    ).rejects.toThrow("STS assume-role failed");

    expect(mockPrisma.connector.update).toHaveBeenCalledWith({
      where: { id: "connector-1" },
      data: { status: ConnectorStatus.ERROR, lastError: "STS assume-role failed" },
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ action: "EVIDENCE_AUTO_COLLECTION_FAILED" }),
    );
  });

  it("skips (does not create evidence) when the advisory lock is already held by a concurrent run", async () => {
    mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ locked: false }]);
      }
      return Promise.resolve([]);
    });

    const result = await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(result).toEqual({ status: "skipped", evidenceCreated: 0 });
    expect(mockPrisma.evidenceMapping.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.evidence.create).not.toHaveBeenCalled();
  });

  it("skips a scheduled (non-manual) run within the idempotency window", async () => {
    const mapping = baseMapping({ lastCollectedAt: new Date(Date.now() - 30_000) });
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);

    const result = await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(result).toEqual({ status: "skipped", evidenceCreated: 0 });
    expect(mockPrisma.evidence.create).not.toHaveBeenCalled();
  });

  it("does NOT skip a manual 'Collect now' run even within the idempotency window", async () => {
    const mapping = baseMapping({ lastCollectedAt: new Date(Date.now() - 30_000) });
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);
    mockPrisma.evidence.create.mockResolvedValue({ id: "evidence-1" });

    const collectEvidence = jest.fn().mockResolvedValue([
      { id: "x", type: "aws_cloudtrail_enabled", fileName: "a.json", collectedAt: new Date(), status: "pass" },
    ]);
    (getConnectorAdapter as jest.Mock).mockReturnValue({ collectEvidence });

    const result = await processConnectorEvidenceJob(
      fakeJob({ evidenceMappingId: "mapping-1", manual: true }),
    );

    expect(result.status).toBe("collected");
    expect(mockPrisma.evidence.create).toHaveBeenCalledTimes(1);
  });

  it("returns 'no-adapter' and does nothing else when the connector type has no registered adapter", async () => {
    const mapping = baseMapping({ connector: { type: "GITHUB" } });
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(mapping);
    (getConnectorAdapter as jest.Mock).mockImplementation(() => {
      throw new Error("Connector type GITHUB is not yet implemented or supported.");
    });

    const result = await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(result).toEqual({ status: "no-adapter", evidenceCreated: 0 });
    expect(mockPrisma.evidence.create).not.toHaveBeenCalled();
  });

  it("returns 'skipped' when the mapping was deleted before the job ran", async () => {
    mockPrisma.evidenceMapping.findUnique.mockResolvedValue(null);

    const result = await processConnectorEvidenceJob(fakeJob({ evidenceMappingId: "mapping-1" }));

    expect(result).toEqual({ status: "skipped", evidenceCreated: 0 });
  });
});
