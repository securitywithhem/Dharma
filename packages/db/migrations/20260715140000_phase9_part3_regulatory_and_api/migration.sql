-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('UNREAD', 'ACKNOWLEDGED', 'DISMISSED');


-- CreateTable
CREATE TABLE "FrameworkVersion" (
    "id" TEXT NOT NULL,
    "marketplaceItemId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL,
    "controlsSnapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frameworkVersionId" TEXT NOT NULL,
    "diffSummary" JSONB NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'UNREAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FrameworkVersion_marketplaceItemId_publishedAt_idx" ON "FrameworkVersion"("marketplaceItemId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FrameworkVersion_marketplaceItemId_version_key" ON "FrameworkVersion"("marketplaceItemId", "version");

-- CreateIndex
CREATE INDEX "RegulatoryAlert_organizationId_status_idx" ON "RegulatoryAlert"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryAlert_organizationId_frameworkVersionId_key" ON "RegulatoryAlert"("organizationId", "frameworkVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_revokedAt_idx" ON "ApiKey"("organizationId", "revokedAt");

-- AddForeignKey
ALTER TABLE "FrameworkVersion" ADD CONSTRAINT "FrameworkVersion_marketplaceItemId_fkey" FOREIGN KEY ("marketplaceItemId") REFERENCES "MarketplaceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAlert" ADD CONSTRAINT "RegulatoryAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryAlert" ADD CONSTRAINT "RegulatoryAlert_frameworkVersionId_fkey" FOREIGN KEY ("frameworkVersionId") REFERENCES "FrameworkVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

