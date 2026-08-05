-- Organization deletion could not complete for any tenant whose members had
-- published a marketplace item or reviewed one — i.e. real tenant offboarding
-- failed outright. Found while cleaning the dev database in acf75de and only
-- worked around in scripts/clean-test-artifacts.ts; this is the schema fix.
--
-- Root cause: MarketplaceItem and MarketplaceReview are the only two models
-- referencing User that are NOT themselves tenant-scoped. Every other User
-- reference sits on a model that cascades from Organization, so those rows are
-- gone before the User delete is attempted. These two are global published
-- artifacts, so nothing removed them, and their Restrict FKs blocked the
-- cascade.
--
-- SET NULL rather than CASCADE: other organizations import these items, and
-- ImportedItem.sourceItem is already ON DELETE SET NULL, so the schema already
-- treats a published item as outliving its author. Cascading would destroy one
-- tenant's content to offboard a different tenant. Reviews are set-null too
-- because MarketplaceItem.ratings/reviewCount are denormalized — deleting the
-- rows underneath them would overstate an item's rating with nothing to
-- recompute it.
--
-- Backfill: none needed. Every existing row has a valid author/reviewer; the
-- columns only become NULL when a user is actually deleted from here on.

-- DropForeignKey
ALTER TABLE "MarketplaceItem" DROP CONSTRAINT "MarketplaceItem_authorId_fkey";

-- DropForeignKey
ALTER TABLE "MarketplaceReview" DROP CONSTRAINT "MarketplaceReview_reviewerId_fkey";

-- AlterTable
ALTER TABLE "MarketplaceItem" ALTER COLUMN "authorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MarketplaceReview" ALTER COLUMN "reviewerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "MarketplaceItem" ADD CONSTRAINT "MarketplaceItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
