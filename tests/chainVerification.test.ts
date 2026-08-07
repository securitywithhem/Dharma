/**
 * GH #26 — chain verification against a live database.
 *
 * The assertions that matter are the FAILURE ones: a verifier that says
 * "intact" for a chain nobody has tampered with proves almost nothing, because
 * a function returning `{ ok: true }` unconditionally passes that test. So each
 * of the three ways a hash chain can be broken is actually performed against
 * real rows here — modify in place, delete, reorder — and the verifier must
 * catch each one and name where.
 *
 * `partial` is tested too, because it is the honesty property: a range check
 * cannot prove nothing was deleted before the range, and the report says so.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import { computeAuditHash } from "@/server/audit-log";
import {
  verifyChainRange,
  countVerifiableEntries,
  VERIFICATION_PAGE_SIZE,
} from "@/server/services/audit/chainVerification";

const prisma = new PrismaClient();

let orgId: string;

/**
 * Write a correctly-chained run of audit entries directly.
 *
 * Deliberately NOT via createAuditLog: that helper takes a Serializable
 * transaction and an advisory lock per entry, which makes seeding thousands of
 * rows unusably slow, and here we need to control the hashes precisely anyway
 * so we can then break them in specific ways.
 */
async function seedChain(count: number, baseTime = new Date("2026-01-01T00:00:00Z")) {
  let previousHash: string | null = null;
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(baseTime.getTime() + i * 1000);
    const entry = {
      organizationId: orgId,
      userId: null,
      action: `TEST_ACTION_${i}`,
      entity: "Test",
      entityId: `e${i}`,
      changes: { i } as unknown,
      timestamp,
    };
    const currentHash = computeAuditHash({
      ...entry,
      timestamp: timestamp.toISOString(),
      previousHash,
    });
    const row = await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        userId: null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        changes: entry.changes as object,
        timestamp,
        previousHash,
        currentHash,
      },
      select: { id: true },
    });
    ids.push(row.id);
    previousHash = currentHash;
  }

  return ids;
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `chainv-${Date.now()}` } })).id;
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.auditChainVerification.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe("an intact chain verifies — the baseline the failures are measured against", () => {
  it("passes over a small chain and reports the count", async () => {
    await seedChain(25);
    const result = await verifyChainRange(prisma, orgId);

    expect(result.ok).toBe(true);
    expect(result.totalChecked).toBe(25);
    expect(result.brokenAtId).toBeNull();
    expect(result.partial).toBe(false);
  });

  it("passes over a chain spanning MULTIPLE pages, carrying the hash across boundaries", async () => {
    // The property the old array-based implementation got for free and the
    // paged one has to earn: a chain longer than one page must still verify,
    // because the last hash of page N is what page N+1's first entry links to.
    // An off-by-one here reports tampering on a clean log at every page break.
    const count = VERIFICATION_PAGE_SIZE + 37;
    await seedChain(count);

    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(true);
    expect(result.totalChecked).toBe(count);
  });

  it("verifies an empty log rather than erroring on it", async () => {
    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(true);
    expect(result.totalChecked).toBe(0);
  });
});

describe("tampering is caught, and located", () => {
  it("catches an entry MODIFIED in place", async () => {
    const ids = await seedChain(20);

    // Change the payload without touching the stored hash — what an attacker
    // with database access does when they want an action to read differently.
    await prisma.auditLog.update({
      where: { id: ids[10] },
      data: { action: "TAMPERED_ACTION" },
    });

    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(ids[10]);
    expect(result.reason).toMatch(/current hash mismatch/i);
    // Located, not merely detected — the issue's acceptance criterion is that a
    // failure identifies WHERE the chain diverges.
    expect(result.brokenAtTimestamp).toBeInstanceOf(Date);
    // And it stopped at the divergence rather than walking the rest.
    expect(result.totalChecked).toBe(10);
  });

  it("catches an entry DELETED from the middle", async () => {
    const ids = await seedChain(20);
    await prisma.auditLog.delete({ where: { id: ids[8] } });

    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(false);
    // The entry AFTER the deletion is where the break shows: its back-link now
    // points at a hash no surviving entry carries.
    expect(result.brokenAtId).toBe(ids[9]);
    expect(result.reason).toMatch(/previous hash mismatch/i);
  });

  it("catches an entry whose stored back-link was rewritten to hide a deletion", async () => {
    const ids = await seedChain(20);
    const victim = await prisma.auditLog.findUniqueOrThrow({ where: { id: ids[5] } });

    // The more sophisticated attack: delete an entry AND repair the next one's
    // previousHash so the links look continuous. It still fails, because the
    // repaired entry's own currentHash was computed over the OLD previousHash.
    await prisma.auditLog.delete({ where: { id: ids[4] } });
    await prisma.auditLog.update({
      where: { id: ids[5] },
      data: { previousHash: (await prisma.auditLog.findUniqueOrThrow({ where: { id: ids[3] } })).currentHash },
    });

    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(victim.id);
    expect(result.reason).toMatch(/current hash mismatch/i);
  });

  it("catches tampering that falls in a LATER page, not just the first", async () => {
    // Guards a plausible bug in the paged walk: a verifier that only checked
    // the first page would pass every test above and miss everything after
    // entry 1,000 — which is the whole population this rewrite exists for.
    const count = VERIFICATION_PAGE_SIZE + 50;
    const ids = await seedChain(count);
    const target = ids[VERIFICATION_PAGE_SIZE + 20];

    await prisma.auditLog.update({
      where: { id: target },
      data: { entityId: "tampered" },
    });

    const result = await verifyChainRange(prisma, orgId);
    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(target);
  });
});

describe("range-bounded verification is honest about what it did not prove", () => {
  it("marks a run with a start bound as partial", async () => {
    const base = new Date("2026-01-01T00:00:00Z");
    await seedChain(30, base);

    const result = await verifyChainRange(prisma, orgId, {
      from: new Date(base.getTime() + 10_000),
    });

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.totalChecked).toBe(20);
  });

  it("does NOT report a false break on the first entry of a partial range", async () => {
    // The bug this guards: the first entry inside a range legitimately links to
    // a predecessor outside it. A verifier that expected `previousHash === null`
    // there would accuse a perfectly intact chain of tampering — the worst
    // possible false positive for a feature whose output an auditor relies on.
    const base = new Date("2026-02-01T00:00:00Z");
    await seedChain(15, base);

    const result = await verifyChainRange(prisma, orgId, {
      from: new Date(base.getTime() + 5_000),
    });

    expect(result.ok).toBe(true);
    expect(result.brokenAtId).toBeNull();
  });

  it("still catches tampering INSIDE a partial range", async () => {
    const base = new Date("2026-03-01T00:00:00Z");
    const ids = await seedChain(20, base);
    await prisma.auditLog.update({ where: { id: ids[12] }, data: { action: "X" } });

    const result = await verifyChainRange(prisma, orgId, {
      from: new Date(base.getTime() + 5_000),
    });

    expect(result.ok).toBe(false);
    expect(result.brokenAtId).toBe(ids[12]);
  });

  it("a full-range run is NOT marked partial", async () => {
    await seedChain(10);
    const result = await verifyChainRange(prisma, orgId, { to: new Date("2030-01-01") });
    expect(result.partial).toBe(false);
  });
});

describe("countVerifiableEntries agrees with what the walk checks", () => {
  it("returns the same number the verifier goes on to check", async () => {
    await seedChain(42);
    const count = await countVerifiableEntries(prisma, orgId);
    const result = await verifyChainRange(prisma, orgId);

    // These two must agree, because the router uses the count to decide whether
    // an inline walk is safe. A disagreement means the size guard is guarding
    // the wrong number.
    expect(count).toBe(42);
    expect(result.totalChecked).toBe(count);
  });

  it("respects the range when counting", async () => {
    const base = new Date("2026-04-01T00:00:00Z");
    await seedChain(30, base);
    const count = await countVerifiableEntries(prisma, orgId, {
      from: new Date(base.getTime() + 10_000),
    });
    expect(count).toBe(20);
  });
});

describe("tenant isolation", () => {
  it("never reads another organization's entries into the walk", async () => {
    const other = await prisma.organization.create({ data: { name: `chainv-other-${Date.now()}` } });
    try {
      await seedChain(5);
      // A foreign entry whose hashes are meaningless in this org's chain. If
      // the walk were not org-scoped, this would surface as a chain break —
      // i.e. one tenant's data would make another tenant's audit log appear
      // tampered with.
      await prisma.auditLog.create({
        data: {
          organizationId: other.id,
          action: "FOREIGN",
          entity: "Test",
          entityId: "x",
          timestamp: new Date("2026-01-01T00:00:02Z"),
          previousHash: "deadbeef",
          currentHash: "cafebabe",
        },
      });

      const result = await verifyChainRange(prisma, orgId);
      expect(result.ok).toBe(true);
      expect(result.totalChecked).toBe(5);
    } finally {
      await prisma.auditLog.deleteMany({ where: { organizationId: other.id } });
      await prisma.organization.delete({ where: { id: other.id } });
    }
  });
});
