import { computeAuditHash, verifyAuditChain } from "@/server/audit-log";
import { seedDatabase } from "../packages/db/seed";

describe("database foundation", () => {
  it("computes deterministic audit hashes", () => {
    const hash = computeAuditHash({
      organizationId: "org_1",
      userId: "user_1",
      action: "POLICY_CREATED",
      entity: "Policy",
      entityId: "policy_1",
      changes: { title: "Privacy Policy" },
      timestamp: "2026-06-21T00:00:00.000Z",
      previousHash: null
    });

    expect(hash).toHaveLength(64);
    expect(hash).toBe(
      computeAuditHash({
        organizationId: "org_1",
        userId: "user_1",
        action: "POLICY_CREATED",
        entity: "Policy",
        entityId: "policy_1",
        changes: { title: "Privacy Policy" },
        timestamp: "2026-06-21T00:00:00.000Z",
        previousHash: null
      }),
    );
  });

  it("detects broken audit chains", () => {
    const firstHash = computeAuditHash({
      organizationId: "org_1",
      userId: "user_1",
      action: "FRAMEWORK_CREATED",
      entity: "Framework",
      entityId: "fw_1",
      changes: { name: "DPDP" },
      timestamp: "2026-06-21T00:00:00.000Z",
      previousHash: null
    });

    const result = verifyAuditChain([
      {
        id: "log_1",
        organizationId: "org_1",
        userId: "user_1",
        action: "FRAMEWORK_CREATED",
        entity: "Framework",
        entityId: "fw_1",
        changes: { name: "DPDP" },
        timestamp: new Date("2026-06-21T00:00:00.000Z"),
        previousHash: null,
        currentHash: firstHash
      },
      {
        id: "log_2",
        organizationId: "org_1",
        userId: "user_1",
        action: "CONTROL_STATUS_UPDATED",
        entity: "Control",
        entityId: "ctrl_1",
        changes: { status: "COMPLIANT" },
        timestamp: new Date("2026-06-21T00:01:00.000Z"),
        previousHash: "tampered",
        currentHash: "tampered"
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe("log_2");
  });

  it("seeds the default organization and frameworks", async () => {
    const mockClient = {
      organization: {
        upsert: jest.fn().mockResolvedValue({
          id: "org-default"
        })
      },
      framework: {
        createMany: jest.fn().mockResolvedValue({ count: 3 })
      },
      user: {
        upsert: jest.fn()
      }
    };

    const result = await seedDatabase(mockClient as never);

    expect(result.organizationId).toBe("org-default");
    expect(mockClient.organization.upsert).toHaveBeenCalled();
    expect(mockClient.framework.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true
      }),
    );
  });
});
