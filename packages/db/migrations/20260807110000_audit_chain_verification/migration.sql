-- GH #26 — persisted audit-chain verification runs.

CREATE TYPE "AuditVerificationStatus" AS ENUM ('RUNNING', 'PASSED', 'FAILED', 'ERRORED');
CREATE TYPE "AuditVerificationTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

CREATE TABLE "AuditChainVerification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "AuditVerificationStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "AuditVerificationTrigger" NOT NULL DEFAULT 'MANUAL',
    "rangeFrom" TIMESTAMP(3),
    "rangeTo" TIMESTAMP(3),
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "entriesChecked" INTEGER NOT NULL DEFAULT 0,
    -- Deliberately not a foreign key to "AuditLog": the most likely cause of a
    -- broken chain is a DELETED entry, and an FK would make it impossible to
    -- record the id of the row that is no longer there.
    "brokenAtId" TEXT,
    "brokenAtTimestamp" TIMESTAMP(3),
    "failureReason" TEXT,
    "reportObjectKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "requestedById" TEXT,

    CONSTRAINT "AuditChainVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditChainVerification_organizationId_startedAt_idx" ON "AuditChainVerification"("organizationId", "startedAt");
CREATE INDEX "AuditChainVerification_organizationId_status_idx" ON "AuditChainVerification"("organizationId", "status");

ALTER TABLE "AuditChainVerification" ADD CONSTRAINT "AuditChainVerification_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting the user who ran a verification must not
-- delete the attestation they produced. That artefact is the thing an auditor
-- was handed.
ALTER TABLE "AuditChainVerification" ADD CONSTRAINT "AuditChainVerification_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The composite the verification walk pages on. Without it, verifying an org's
-- full history sorts the whole partition on every page.
CREATE INDEX "AuditLog_organizationId_timestamp_createdAt_id_idx"
    ON "AuditLog"("organizationId", "timestamp", "createdAt", "id");
