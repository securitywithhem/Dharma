-- WAVE 0.1 — scan-target ownership verification.
--
-- Adds VerifiedAsset: the DB-backed authorization record that gates
-- pentest.create and pentestScanWorker. Before this, the only ownership
-- control was a client-side checkbox.
--
-- Purely additive: no existing table or column is touched, so this is safe to
-- apply ahead of the application deploy. Note the consequence, which is
-- intended — after the application deploy, every existing PenTest target is
-- unverified, and NEW scans against it will be rejected until an admin
-- verifies the domain. Historical PenTest rows are untouched and still
-- readable. There is deliberately no backfill: auto-verifying whatever happens
-- to be in the table would grant authorization to exactly the unowned targets
-- (e.g. google.com in the demo data) that this control exists to stop.

-- CreateEnum
CREATE TYPE "VerifiedAssetKind" AS ENUM ('DOMAIN', 'CIDR');

-- CreateEnum
CREATE TYPE "AssetVerificationMethod" AS ENUM ('DNS_TXT', 'HTTP_FILE');

-- CreateTable
CREATE TABLE "VerifiedAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "kind" "VerifiedAssetKind" NOT NULL DEFAULT 'DOMAIN',
    "method" "AssetVerificationMethod" NOT NULL DEFAULT 'DNS_TXT',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "requestedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedAsset_organizationId_value_key" ON "VerifiedAsset"("organizationId", "value");

-- CreateIndex
CREATE INDEX "VerifiedAsset_organizationId_verifiedAt_idx" ON "VerifiedAsset"("organizationId", "verifiedAt");

-- AddForeignKey
-- Cascade on the org relation, matching the repo-wide tenant-relation
-- convention (Coding_Standards.md).
ALTER TABLE "VerifiedAsset" ADD CONSTRAINT "VerifiedAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedAsset" ADD CONSTRAINT "VerifiedAsset_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedAsset" ADD CONSTRAINT "VerifiedAsset_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
