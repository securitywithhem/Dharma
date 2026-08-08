import { describe, it, expect, afterAll } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

/**
 * Tenant offboarding: deleting an Organization must actually delete it.
 *
 * This failed outright for any tenant whose members had published a
 * marketplace item or reviewed one — the real offboarding path, found while
 * cleaning the dev database in acf75de and until now only worked around in
 * scripts/clean-test-artifacts.ts.
 *
 * Every test here fails on the pre-fix schema, where MarketplaceItem.authorId
 * and MarketplaceReview.reviewerId were NOT NULL with Restrict FKs.
 */

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;
function uniq(label: string) {
  seq += 1;
  return `${label}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedOrgWithUser(label: string) {
  const org = await prisma.organization.create({ data: { name: uniq(label) } });
  const user = await prisma.user.create({
    data: { email: `${uniq(label)}@cascade.test`, organizationId: org.id },
  });
  return { org, user };
}

async function seedItem(authorId: string) {
  return prisma.marketplaceItem.create({
    data: {
      type: "FRAMEWORK",
      name: "Cascade Test Item",
      slug: uniq("cascade-item"),
      description: "Published by an org that is about to be deleted.",
      authorId,
      metadata: {},
      category: "compliance",
    },
  });
}

describe("Organization deletion cascades", () => {
  it("deletes an organization with no marketplace activity (baseline)", async () => {
    const { org } = await seedOrgWithUser("cascade-baseline");
    await expect(prisma.organization.delete({ where: { id: org.id } })).resolves.toBeTruthy();
  });

  it("deletes an organization whose member published a marketplace item", async () => {
    const { org, user } = await seedOrgWithUser("cascade-author");
    const item = await seedItem(user.id);

    await expect(prisma.organization.delete({ where: { id: org.id } })).resolves.toBeTruthy();

    // The published item SURVIVES, anonymized. Cascading it away would destroy
    // content other tenants may have imported in order to offboard this one.
    const surviving = await prisma.marketplaceItem.findUnique({ where: { id: item.id } });
    expect(surviving).not.toBeNull();
    expect(surviving?.authorId).toBeNull();

    await prisma.marketplaceItem.delete({ where: { id: item.id } });
  });

  it("deletes an organization whose member only REVIEWED someone else's item", async () => {
    // The case that is easy to miss: this org never published anything.
    const author = await seedOrgWithUser("cascade-rev-author");
    const reviewer = await seedOrgWithUser("cascade-rev-reviewer");
    const item = await seedItem(author.user.id);

    const review = await prisma.marketplaceReview.create({
      data: {
        marketplaceItemId: item.id,
        reviewerId: reviewer.user.id,
        rating: 5,
        title: "Useful",
        content: "Saved us a week of control mapping.",
      },
    });

    await expect(
      prisma.organization.delete({ where: { id: reviewer.org.id } }),
    ).resolves.toBeTruthy();

    // The review survives anonymized, so the item's denormalized `ratings` and
    // `reviewCount` are not silently left overstating a review that vanished.
    const survivingReview = await prisma.marketplaceReview.findUnique({
      where: { id: review.id },
    });
    expect(survivingReview).not.toBeNull();
    expect(survivingReview?.reviewerId).toBeNull();

    await prisma.marketplaceReview.delete({ where: { id: review.id } });
    await prisma.marketplaceItem.delete({ where: { id: item.id } });
    await prisma.organization.delete({ where: { id: author.org.id } });
  });

  it("still cascades genuinely tenant-scoped rows away", async () => {
    const { org, user } = await seedOrgWithUser("cascade-scoped");

    // Ordered asset-then-scan since WAVE 12: PenTest.verifiedAssetId is a
    // required FK, so the authorization has to exist first.
    const asset = await prisma.verifiedAsset.create({
      data: {
        organizationId: org.id,
        value: uniq("cascade") + ".example.com",
        verificationToken: "token",
        requestedById: user.id,
      },
    });
    const penTest = await prisma.penTest.create({
      data: {
        organizationId: org.id,
        target: "example.com",
        type: "EXTERNAL_NETWORK",
        requestedById: user.id,
        verifiedAssetId: asset.id,
      },
    });

    await prisma.organization.delete({ where: { id: org.id } });

    // Tenant data must be GONE, not anonymized — the opposite of the
    // marketplace rows above, and the distinction the fix turns on.
    expect(await prisma.penTest.findUnique({ where: { id: penTest.id } })).toBeNull();
    expect(await prisma.verifiedAsset.findUnique({ where: { id: asset.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("allows several anonymized reviews on one item despite the unique constraint", async () => {
    // @@unique([marketplaceItemId, reviewerId]) enforces one review per user
    // per item. Postgres treats NULLs as distinct, so anonymized rows must be
    // able to accumulate rather than colliding on the second offboarding.
    const author = await seedOrgWithUser("cascade-multi-author");
    const item = await seedItem(author.user.id);

    const reviewIds: string[] = [];
    for (const label of ["multi-a", "multi-b"]) {
      const r = await seedOrgWithUser(label);
      const review = await prisma.marketplaceReview.create({
        data: {
          marketplaceItemId: item.id,
          reviewerId: r.user.id,
          rating: 4,
          title: "Fine",
          content: "Fine.",
        },
      });
      reviewIds.push(review.id);
      await prisma.organization.delete({ where: { id: r.org.id } });
    }

    const anonymized = await prisma.marketplaceReview.findMany({
      where: { marketplaceItemId: item.id, reviewerId: null },
    });
    expect(anonymized).toHaveLength(2);

    await prisma.marketplaceReview.deleteMany({ where: { id: { in: reviewIds } } });
    await prisma.marketplaceItem.delete({ where: { id: item.id } });
    await prisma.organization.delete({ where: { id: author.org.id } });
  });
});
