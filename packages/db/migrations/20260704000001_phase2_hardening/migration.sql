-- Phase 2: Real-World Hardening & Trust Layer
-- Feature 1: Per-org AI Provider config
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "aiProvider" JSONB;

-- Feature 2: Automated Evidence Connectors
CREATE TYPE IF NOT EXISTS "ConnectorProvider" AS ENUM ('GITHUB', 'AWS', 'VERCEL');
CREATE TYPE IF NOT EXISTS "ConnectorStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

CREATE TABLE IF NOT EXISTS "Connector" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider"       "ConnectorProvider" NOT NULL,
    "displayName"    TEXT NOT NULL,
    "credentials"    TEXT NOT NULL,
    "config"         JSONB NOT NULL,
    "status"         "ConnectorStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt"      TIMESTAMP(3),
    "lastRunStatus"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Connector_organizationId_provider_displayName_key" UNIQUE ("organizationId", "provider", "displayName")
);
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Connector_organizationId_idx" ON "Connector"("organizationId");

-- Add connectorId to Evidence
ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "connectorId" TEXT;
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Evidence_connectorId_idx" ON "Evidence"("connectorId");

-- Feature 3: External Audit Chain Anchors
CREATE TABLE IF NOT EXISTS "ChainAnchor" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rootHash"       TEXT NOT NULL,
    "recordCount"    INTEGER NOT NULL,
    "fromLogId"      TEXT NOT NULL,
    "toLogId"        TEXT NOT NULL,
    "anchoredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageKey"     TEXT NOT NULL,
    "publicProof"    TEXT,
    CONSTRAINT "ChainAnchor_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ChainAnchor" ADD CONSTRAINT "ChainAnchor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ChainAnchor_organizationId_idx" ON "ChainAnchor"("organizationId");
CREATE INDEX IF NOT EXISTS "ChainAnchor_anchoredAt_idx" ON "ChainAnchor"("anchoredAt");

-- Feature 4: Policy Templates
CREATE TABLE IF NOT EXISTS "PolicyTemplate" (
    "id"           TEXT NOT NULL,
    "policyType"   "PolicyType" NOT NULL,
    "name"         TEXT NOT NULL,
    "version"      TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "variables"    JSONB NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PolicyTemplate_policyType_name_version_key" UNIQUE ("policyType", "name", "version")
);
CREATE INDEX IF NOT EXISTS "PolicyTemplate_policyType_idx" ON "PolicyTemplate"("policyType");

-- Feature 5: Auditor Export Packages
CREATE TABLE IF NOT EXISTS "AuditExport" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "requestedBy"     TEXT NOT NULL,
    "frameworkIds"    JSONB NOT NULL,
    "filePath"        TEXT NOT NULL,
    "includeRawFiles" BOOLEAN NOT NULL DEFAULT false,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuditExport_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AuditExport" ADD CONSTRAINT "AuditExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "AuditExport_organizationId_idx" ON "AuditExport"("organizationId");
CREATE INDEX IF NOT EXISTS "AuditExport_expiresAt_idx" ON "AuditExport"("expiresAt");
