-- WAVE 12 — pluggable scan engines + finding→control mapping.
--
-- Three changes, in dependency order:
--   1. PenTest gains an engine dimension and a REQUIRED verifiedAssetId.
--   2. Vulnerability gains engine provenance (rawFindingId) and pocEvidence.
--   3. New FindingControlMapping table.
--
-- Step 1 is the only risky part: making verifiedAssetId NOT NULL on a table
-- that already has rows. The backfill below is written to satisfy the FK
-- WITHOUT granting any authorization — see the long comment on it.

-- CreateEnum
CREATE TYPE "ScanEngine" AS ENUM ('NUCLEI', 'STRIX', 'ZAP', 'BURP');

-- CreateEnum
CREATE TYPE "MappingSource" AS ENUM ('AI_SUGGESTED', 'HUMAN_CONFIRMED', 'HUMAN_OVERRIDDEN');

-- AlterTable: PenTest engine dimension.
-- DEFAULT 'NUCLEI' is correct history, not a convenience: every pre-WAVE-12
-- row genuinely was a nuclei run.
ALTER TABLE "PenTest" ADD COLUMN "engine" "ScanEngine" NOT NULL DEFAULT 'NUCLEI';
ALTER TABLE "PenTest" ADD COLUMN "engineRunId" TEXT;
ALTER TABLE "PenTest" ADD COLUMN "allowDestructiveTests" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PenTest" ADD COLUMN "failureReason" TEXT;

-- Added nullable so the backfill can run, then tightened to NOT NULL below.
ALTER TABLE "PenTest" ADD COLUMN "verifiedAssetId" TEXT;

-- ---------------------------------------------------------------------------
-- Backfill, pass 1: adopt a real authorization where one already exists.
--
-- Matches runtime semantics (assertTargetVerified → assetCoversTarget): exact
-- hostname, or a parent domain that covers the target as a subdomain. Only
-- DOMAIN assets are matched here; CIDR coverage needs inet arithmetic that
-- belongs in application code, and a CIDR-covered legacy row falls through to
-- pass 2 rather than risking a wrong adoption.
--
-- Deliberately does NOT filter on verifiedAt/revokedAt. This column records
-- WHICH authorization a historical scan ran under — including one since
-- revoked or expired, which is exactly the case an auditor most needs to see.
-- Current-ness is a runtime check, re-run at dispatch; it is not this FK's job.
-- ---------------------------------------------------------------------------
UPDATE "PenTest" p
SET "verifiedAssetId" = (
  SELECT va."id"
  FROM "VerifiedAsset" va
  WHERE va."organizationId" = p."organizationId"
    AND va."kind" = 'DOMAIN'
    AND (
      lower(p."target") = va."value"
      OR lower(p."target") LIKE '%.' || va."value"
    )
  -- Prefer the most specific covering asset (longest value), then the one whose
  -- proof was completed earliest — the authorization actually in force when the
  -- scan ran, rather than one added later.
  ORDER BY length(va."value") DESC, va."verifiedAt" ASC NULLS LAST
  LIMIT 1
)
WHERE p."verifiedAssetId" IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill, pass 2: mint a LEGACY placeholder for orphans.
--
-- Any PenTest still unmatched predates WAVE 0 and ran with no proof of
-- ownership at all — the demo-data `google.com` case the WAVE 0 migration
-- explicitly refused to auto-verify. Two rejected alternatives:
--
--   * Deleting orphan scans — destroys the very history that proves what the
--     platform did before the control existed. Never acceptable in a GRC tool.
--   * Creating VERIFIED assets to satisfy the FK — would hand authorization to
--     precisely the unowned targets WAVE 0 exists to stop, reopening the gap
--     this wave is built on top of. This is the failure mode the wave gate
--     re-runs WAVE 0's tests to catch.
--
-- So the placeholder is minted UNVERIFIED (verifiedAt NULL) *and* revoked. Both
-- independently disqualify it from `assertTargetVerified`, which requires
-- verifiedAt IS NOT NULL AND revokedAt IS NULL. The FK is satisfied, the
-- history is intact, and no new scan can be launched through these rows.
-- verificationToken is a non-secret marker rather than a live challenge: there
-- is no challenge to complete, because this row must never become verified.
-- ---------------------------------------------------------------------------
INSERT INTO "VerifiedAsset" (
  "id", "organizationId", "value", "kind", "method", "verificationToken",
  "verifiedAt", "verifiedById", "requestedById", "revokedAt",
  "failedAttempts", "createdAt", "updatedAt"
)
SELECT
  'legacy-' || md5(p."organizationId" || ':' || lower(p."target")),
  p."organizationId",
  lower(p."target"),
  'DOMAIN',
  'DNS_TXT',
  'wave12-legacy-unverified',
  NULL,
  NULL,
  MIN(p."requestedById"),
  CURRENT_TIMESTAMP,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PenTest" p
WHERE p."verifiedAssetId" IS NULL
GROUP BY p."organizationId", lower(p."target")
-- An unverified request for the same value may already exist from a challenge
-- an admin started and never completed; adopt it rather than colliding.
ON CONFLICT ("organizationId", "value") DO NOTHING;

UPDATE "PenTest" p
SET "verifiedAssetId" = va."id"
FROM "VerifiedAsset" va
WHERE p."verifiedAssetId" IS NULL
  AND va."organizationId" = p."organizationId"
  AND va."value" = lower(p."target");

-- Fail the migration loudly rather than leaving a half-migrated table if any
-- row escaped both passes (e.g. a target that does not lowercase to a stable
-- value). A silent partial migration in the authorization path is worse than
-- an aborted deploy.
DO $$
DECLARE orphan_count INTEGER;
BEGIN
  SELECT count(*) INTO orphan_count FROM "PenTest" WHERE "verifiedAssetId" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'WAVE 12 backfill left % PenTest row(s) without a verifiedAssetId', orphan_count;
  END IF;
END $$;

-- Now safe to enforce.
ALTER TABLE "PenTest" ALTER COLUMN "verifiedAssetId" SET NOT NULL;

-- AddForeignKey
-- ON DELETE RESTRICT (Prisma's default when no rule is declared): a
-- VerifiedAsset with scan history must not be deletable out from under the
-- scans it authorized. Revocation (revokedAt) is the supported withdrawal
-- path and preserves the trail.
ALTER TABLE "PenTest" ADD CONSTRAINT "PenTest_verifiedAssetId_fkey"
  FOREIGN KEY ("verifiedAssetId") REFERENCES "VerifiedAsset"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PenTest_verifiedAssetId_idx" ON "PenTest"("verifiedAssetId");

-- AlterTable: Vulnerability engine provenance + proof of concept.
ALTER TABLE "Vulnerability" ADD COLUMN "rawFindingId" TEXT;
ALTER TABLE "Vulnerability" ADD COLUMN "pocEvidence" JSONB;

-- CreateTable
CREATE TABLE "FindingControlMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vulnerabilityId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "mappingSource" "MappingSource" NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingControlMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FindingControlMapping_vulnerabilityId_controlId_key"
  ON "FindingControlMapping"("vulnerabilityId", "controlId");

-- CreateIndex
CREATE INDEX "FindingControlMapping_organizationId_mappingSource_createdAt_idx"
  ON "FindingControlMapping"("organizationId", "mappingSource", "createdAt");

-- CreateIndex
CREATE INDEX "FindingControlMapping_controlId_mappingSource_idx"
  ON "FindingControlMapping"("controlId", "mappingSource");

-- AddForeignKey
ALTER TABLE "FindingControlMapping" ADD CONSTRAINT "FindingControlMapping_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingControlMapping" ADD CONSTRAINT "FindingControlMapping_vulnerabilityId_fkey"
  FOREIGN KEY ("vulnerabilityId") REFERENCES "Vulnerability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingControlMapping" ADD CONSTRAINT "FindingControlMapping_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
