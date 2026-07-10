-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'PAUSED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('AWS', 'AZURE', 'GCP', 'GITHUB', 'OKTA', 'JIRA', 'VERCEL');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('FRAMEWORK', 'TEMPLATE', 'CONNECTOR');

-- AlterEnum
BEGIN;
CREATE TYPE "ConnectorStatus_new" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'TESTING');
ALTER TABLE "Connector" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Connector" ALTER COLUMN "status" TYPE "ConnectorStatus_new" USING ("status"::text::"ConnectorStatus_new");
ALTER TYPE "ConnectorStatus" RENAME TO "ConnectorStatus_old";
ALTER TYPE "ConnectorStatus_new" RENAME TO "ConnectorStatus";
DROP TYPE "ConnectorStatus_old";
ALTER TABLE "Connector" ALTER COLUMN "status" SET DEFAULT 'DISCONNECTED';
COMMIT;

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PUBLISHER';

-- DropIndex
ALTER TABLE "Connector" DROP CONSTRAINT "Connector_organizationId_provider_displayName_key";

-- AlterTable
ALTER TABLE "Connector" DROP COLUMN "displayName",
DROP COLUMN "lastRunAt",
DROP COLUMN "lastRunStatus",
DROP COLUMN "provider",
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "type" "ConnectorType" NOT NULL,
ALTER COLUMN "credentials" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'DISCONNECTED';

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "Framework" ADD COLUMN     "importedItemId" TEXT,
ADD COLUMN     "marketplaceSourceId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" DEFAULT 'ACTIVE';

-- DropEnum
DROP TYPE "ConnectorProvider";

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "limits" JSONB NOT NULL,
    "features" JSONB,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceMapping" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "schedule" TEXT,
    "lastCollectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceItem" (
    "id" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "authorId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[],
    "logo" TEXT,
    "coverImage" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "ratings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "MarketplaceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceReview" (
    "id" TEXT NOT NULL,
    "marketplaceItemId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceItemRevision" (
    "id" TEXT NOT NULL,
    "marketplaceItemId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "changeNotes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplaceItemId" TEXT,
    "itemType" "ItemType" NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemVersion" TEXT NOT NULL,
    "importedFrameworkId" TEXT,
    "sourceMetadata" JSONB,
    "customizations" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE INDEX "Plan_name_idx" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceItem_slug_key" ON "MarketplaceItem"("slug");

-- CreateIndex
CREATE INDEX "MarketplaceItem_authorId_isPublic_createdAt_idx" ON "MarketplaceItem"("authorId", "isPublic", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceItem_category_isPublic_idx" ON "MarketplaceItem"("category", "isPublic");

-- CreateIndex
CREATE INDEX "MarketplaceReview_marketplaceItemId_rating_idx" ON "MarketplaceReview"("marketplaceItemId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceReview_marketplaceItemId_reviewerId_key" ON "MarketplaceReview"("marketplaceItemId", "reviewerId");

-- CreateIndex
CREATE INDEX "ImportedItem_organizationId_importedAt_idx" ON "ImportedItem"("organizationId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedItem_organizationId_marketplaceItemId_key" ON "ImportedItem"("organizationId", "marketplaceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMapping" ADD CONSTRAINT "EvidenceMapping_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceMapping" ADD CONSTRAINT "EvidenceMapping_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceItem" ADD CONSTRAINT "MarketplaceItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_marketplaceItemId_fkey" FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceReview" ADD CONSTRAINT "MarketplaceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceItemRevision" ADD CONSTRAINT "MarketplaceItemRevision_marketplaceItemId_fkey" FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedItem" ADD CONSTRAINT "ImportedItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportedItem" ADD CONSTRAINT "ImportedItem_marketplaceItemId_fkey" FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

