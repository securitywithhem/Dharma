// Phase 9 Part 3 — regulatory change monitoring: diff engine correctness +
// fanout isolation (alerts only for orgs that imported the framework).
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import { diffControlSnapshots, isEmptyDiff } from "@/server/lib/regulatory/diffEngine";
import { publishFrameworkVersion } from "@/server/lib/regulatory/versionPoller";
import { createRegulatoryFanoutProcessor } from "@/server/queue/workers/regulatoryFanoutWorker";

const prisma = new PrismaClient();

describe("diffControlSnapshots", () => {
  const v1 = [
    { code: "A.1", title: "Access control", description: "old" },
    { code: "A.2", title: "Encryption", description: "same" },
    { code: "A.3", title: "To be removed", description: "x" },
  ];
  const v2 = [
    { code: "A.1", title: "Access control", description: "UPDATED" }, // modified (description)
    { code: "A.2", title: "Encryption", description: "same" }, // unchanged
    { code: "A.4", title: "New control", description: "y" }, // added
    // A.3 removed
  ];

  it("computes added / removed / modified correctly", () => {
    const diff = diffControlSnapshots(v1, v2);
    expect(diff.added.map((a) => a.key)).toEqual(["A.4"]);
    expect(diff.removed.map((r) => r.key)).toEqual(["A.3"]);
    expect(diff.modified.map((m) => m.key)).toEqual(["A.1"]);
    expect(diff.modified[0].changedFields).toContain("description");
  });

  it("identical snapshots produce an empty diff", () => {
    expect(isEmptyDiff(diffControlSnapshots(v1, v1))).toBe(true);
  });

  it("tolerates { controls: [...] } wrapper and missing keys", () => {
    const diff = diffControlSnapshots({ controls: v1 }, { controls: v2 });
    expect(diff.added.map((a) => a.key)).toEqual(["A.4"]);
    // Controls without a code/id are ignored (can't be tracked).
    const noKey = diffControlSnapshots([{ title: "keyless" }], [{ title: "keyless2" }]);
    expect(isEmptyDiff(noKey)).toBe(true);
  });
});

describe("regulatory fanout isolation", () => {
  let marketplaceItemId: string;
  let authorId: string;
  let orgImporterA: string;
  let orgImporterB: string;
  let orgUnrelated: string;

  async function makeOrg(label: string) {
    const org = await prisma.organization.create({
      data: { name: `${label} ${Date.now()}-${Math.random()}` },
    });
    return org.id;
  }

  beforeAll(async () => {
    orgImporterA = await makeOrg("RegA");
    orgImporterB = await makeOrg("RegB");
    orgUnrelated = await makeOrg("RegUnrelated");

    const author = await prisma.user.create({
      data: { email: `reg-author-${Date.now()}@t.test`, organizationId: orgImporterA, role: "PUBLISHER" },
    });
    authorId = author.id;

    const item = await prisma.marketplaceItem.create({
      data: {
        type: "FRAMEWORK",
        slug: `fw-${Date.now()}`,
        name: "ISO Test Framework",
        description: "d",
        authorId,
        category: "security",
        metadata: {},
      },
    });
    marketplaceItemId = item.id;

    // Only A and B import this framework; the unrelated org imports nothing.
    await prisma.importedItem.create({
      data: { organizationId: orgImporterA, marketplaceItemId, itemType: "FRAMEWORK", itemName: "ISO Test Framework", itemVersion: "1.0" },
    });
    await prisma.importedItem.create({
      data: { organizationId: orgImporterB, marketplaceItemId, itemType: "FRAMEWORK", itemName: "ISO Test Framework", itemVersion: "1.0" },
    });
  });

  afterAll(async () => {
    for (const id of [orgImporterA, orgImporterB, orgUnrelated]) {
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("first publish has no diff; second publish diffs against the first", async () => {
    const first = await publishFrameworkVersion(prisma, {
      marketplaceItemId,
      version: "1.0",
      changelog: "initial",
      controlsSnapshot: [{ code: "C.1", title: "One", description: "a" }],
    });
    expect(first.isFirstVersion).toBe(true);
    expect(first.diff).toBeNull();

    const second = await publishFrameworkVersion(prisma, {
      marketplaceItemId,
      version: "2.0",
      changelog: "update",
      controlsSnapshot: [
        { code: "C.1", title: "One", description: "CHANGED" },
        { code: "C.2", title: "Two", description: "b" },
      ],
    });
    expect(second.isFirstVersion).toBe(false);
    expect(second.diff?.added.map((a) => a.key)).toEqual(["C.2"]);
    expect(second.diff?.modified.map((m) => m.key)).toEqual(["C.1"]);

    // Fan out the second version.
    const processor = createRegulatoryFanoutProcessor(prisma);
    const result = (await processor({
      data: {
        frameworkVersionId: second.frameworkVersionId,
        marketplaceItemId,
        version: "2.0",
        diff: second.diff,
      },
    } as never)) as { importers: number; alertsCreated: number };

    expect(result.importers).toBe(2);
    expect(result.alertsCreated).toBe(2);

    // Alerts exist for A and B, NEVER for the unrelated org.
    const alertA = await prisma.regulatoryAlert.findFirst({ where: { organizationId: orgImporterA, frameworkVersionId: second.frameworkVersionId } });
    const alertB = await prisma.regulatoryAlert.findFirst({ where: { organizationId: orgImporterB, frameworkVersionId: second.frameworkVersionId } });
    const alertUnrelated = await prisma.regulatoryAlert.findFirst({ where: { organizationId: orgUnrelated } });
    expect(alertA).not.toBeNull();
    expect(alertB).not.toBeNull();
    expect(alertUnrelated).toBeNull();

    // Audit written for the created alerts.
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgImporterA, action: "REGULATORY_ALERT_CREATED" },
    });
    expect(audit).not.toBeNull();
  });

  it("fanout is idempotent — a re-run creates no duplicate alerts", async () => {
    const version = await publishFrameworkVersion(prisma, {
      marketplaceItemId,
      version: "3.0",
      changelog: "again",
      controlsSnapshot: [{ code: "C.1", title: "One", description: "z" }],
    });
    const processor = createRegulatoryFanoutProcessor(prisma);
    const job = { data: { frameworkVersionId: version.frameworkVersionId, marketplaceItemId, version: "3.0", diff: version.diff } } as never;

    const first = (await processor(job)) as { alertsCreated: number };
    const second = (await processor(job)) as { alertsCreated: number };
    expect(first.alertsCreated).toBe(2);
    expect(second.alertsCreated).toBe(0); // unique constraint → skip-on-conflict

    const count = await prisma.regulatoryAlert.count({
      where: { frameworkVersionId: version.frameworkVersionId },
    });
    expect(count).toBe(2);
  });
});
