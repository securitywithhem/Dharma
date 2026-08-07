/**
 * GH #20 — "Verification expires and requires re-proof."
 *
 * The one acceptance criterion from the VAPT authorization issue that WAVE 0
 * left open: the ownership challenge was built, enforced at create and at
 * dispatch, and recorded — but a proof, once given, was good forever.
 *
 * The scenario this closes is not hypothetical. An org proves control of
 * `acme-staging.com` in January, lets the registration lapse in June, and by
 * August it belongs to a stranger. Nothing about the original proof became
 * false; it simply stopped describing the present. Without expiry, Dharma
 * keeps pointing scan traffic at a third party's infrastructure with a
 * verification record that says everything is fine — which is precisely the
 * legal exposure the issue was filed about, arriving by a different route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

import {
  assertTargetVerified,
  isVerificationCurrent,
  verificationExpiresAt,
  TargetNotVerifiedError,
  VerificationExpiredError,
  VERIFICATION_VALIDITY_DAYS,
  VERIFICATION_VALIDITY_MS,
} from "@/server/pentest/assetVerification";

const prisma = new PrismaClient();

let orgId: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function seedAsset(opts: {
  value: string;
  verifiedAt: Date | null;
  revokedAt?: Date | null;
}) {
  return prisma.verifiedAsset.create({
    data: {
      organizationId: orgId,
      value: opts.value,
      kind: "DOMAIN",
      method: "DNS_TXT",
      verificationToken: `tok_${Math.random().toString(36).slice(2)}`,
      verifiedAt: opts.verifiedAt,
      revokedAt: opts.revokedAt ?? null,
      requestedById: userId,
    },
  });
}

let userId: string;

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `expiry-${Date.now()}` } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `expiry-${Date.now()}@test.dharma`, organizationId: orgId },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.verifiedAsset.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  await prisma.verifiedAsset.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe("the validity window itself", () => {
  it("is 90 days, and expiresAt is derived from verifiedAt", () => {
    expect(VERIFICATION_VALIDITY_DAYS).toBe(90);
    const verifiedAt = new Date("2026-01-01T00:00:00Z");
    expect(verificationExpiresAt(verifiedAt).getTime()).toBe(
      verifiedAt.getTime() + VERIFICATION_VALIDITY_MS,
    );
  });

  it("treats a never-verified or revoked asset as not current, regardless of dates", () => {
    expect(isVerificationCurrent({ verifiedAt: null, revokedAt: null })).toBe(false);
    // Revocation beats freshness: an admin who withdrew the claim yesterday
    // must not be overridden by a proof given an hour ago.
    expect(isVerificationCurrent({ verifiedAt: new Date(), revokedAt: new Date() })).toBe(false);
  });

  it("is current at 89 days and stale at 91", () => {
    expect(isVerificationCurrent({ verifiedAt: daysAgo(89), revokedAt: null })).toBe(true);
    expect(isVerificationCurrent({ verifiedAt: daysAgo(91), revokedAt: null })).toBe(false);
  });
});

describe("assertTargetVerified enforces expiry at the authorization gate", () => {
  it("authorizes a target whose proof is still current — baseline", async () => {
    await seedAsset({ value: "fresh.example.com", verifiedAt: daysAgo(10) });
    const asset = await assertTargetVerified(prisma, orgId, "fresh.example.com");
    expect(asset.value).toBe("fresh.example.com");
  });

  it("REFUSES a target whose proof has expired", async () => {
    // The core assertion. Before this change the same row authorized the scan.
    await seedAsset({ value: "stale.example.com", verifiedAt: daysAgo(120) });

    await expect(assertTargetVerified(prisma, orgId, "stale.example.com")).rejects.toBeInstanceOf(
      VerificationExpiredError,
    );
  });

  it("distinguishes EXPIRED from NEVER VERIFIED", async () => {
    await seedAsset({ value: "stale.example.com", verifiedAt: daysAgo(120) });

    // These are different problems with different fixes. An operator told
    // "you never verified this" for a domain they verified in January goes
    // looking for a setup step that already happened.
    await expect(
      assertTargetVerified(prisma, orgId, "stale.example.com"),
    ).rejects.toBeInstanceOf(VerificationExpiredError);

    await expect(
      assertTargetVerified(prisma, orgId, "never-seen.example.com"),
    ).rejects.toBeInstanceOf(TargetNotVerifiedError);

    // And VerificationExpiredError must not be a subclass of the other, or the
    // distinction the router branches on would collapse.
    expect(new VerificationExpiredError("x")).not.toBeInstanceOf(TargetNotVerifiedError);
  });

  it("names the expiry date in the message so the fix is obvious", async () => {
    await seedAsset({ value: "stale.example.com", verifiedAt: daysAgo(120) });

    await expect(
      assertTargetVerified(prisma, orgId, "stale.example.com"),
    ).rejects.toThrow(/expired on \d{4}-\d{2}-\d{2}/);
    await expect(
      assertTargetVerified(prisma, orgId, "stale.example.com"),
    ).rejects.toThrow(/Re-verify/i);
  });

  it("authorizes again once the target is re-verified", async () => {
    // Expiry must be recoverable by re-proving, not a permanent ban.
    const asset = await seedAsset({ value: "renewed.example.com", verifiedAt: daysAgo(120) });
    await expect(
      assertTargetVerified(prisma, orgId, "renewed.example.com"),
    ).rejects.toBeInstanceOf(VerificationExpiredError);

    await prisma.verifiedAsset.update({
      where: { id: asset.id },
      data: { verifiedAt: new Date() },
    });

    await expect(assertTargetVerified(prisma, orgId, "renewed.example.com")).resolves.toMatchObject(
      { value: "renewed.example.com" },
    );
  });

  it("prefers a current proof when a stale one also matches", async () => {
    // Two rows can cover one target (an apex claim and a subdomain claim). The
    // gate must authorize on the CURRENT one rather than refusing because some
    // other matching row went stale.
    await seedAsset({ value: "example.com", verifiedAt: daysAgo(200) });
    await seedAsset({ value: "api.example.com", verifiedAt: daysAgo(5) });

    const asset = await assertTargetVerified(prisma, orgId, "api.example.com");
    expect(asset.value).toBe("api.example.com");
  });

  it("still refuses a revoked asset ahead of any expiry consideration", async () => {
    await seedAsset({
      value: "revoked.example.com",
      verifiedAt: daysAgo(1),
      revokedAt: new Date(),
    });

    await expect(
      assertTargetVerified(prisma, orgId, "revoked.example.com"),
    ).rejects.toBeInstanceOf(TargetNotVerifiedError);
  });
});
