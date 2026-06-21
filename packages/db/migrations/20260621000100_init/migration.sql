CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TYPE "Role" AS ENUM ('ADMIN', 'COMPLIANCE_MANAGER', 'VIEWER');
CREATE TYPE "ControlStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLIANT', 'NOT_APPLICABLE');
CREATE TYPE "EvidenceType" AS ENUM ('SCREENSHOT', 'POLICY_DOC', 'API_RESPONSE', 'LOG_EXCERPT', 'CERTIFICATE', 'OTHER');
CREATE TYPE "PolicyType" AS ENUM ('PRIVACY_POLICY', 'DATA_RETENTION', 'ACCESS_CONTROL', 'INCIDENT_RESPONSE', 'OTHER');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "image" TEXT,
  "emailVerified" TIMESTAMP(3),
  "role" "Role" NOT NULL DEFAULT 'VIEWER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Framework" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "Framework_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Control" (
  "id" TEXT NOT NULL,
  "frameworkId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "guidance" TEXT,
  "status" "ControlStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Control_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Evidence" (
  "id" TEXT NOT NULL,
  "controlId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "type" "EvidenceType" NOT NULL,
  "summary" TEXT,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "embedding" vector(384),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Policy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "policyType" "PolicyType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "changes" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousHash" TEXT,
  "currentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegulationSnippet" (
  "id" TEXT NOT NULL,
  "frameworkName" TEXT NOT NULL,
  "sectionNumber" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(384),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegulationSnippet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditorAccess" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditorAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationInvite" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'VIEWER',
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE UNIQUE INDEX "Framework_organizationId_name_key" ON "Framework"("organizationId", "name");
CREATE UNIQUE INDEX "AuditorAccess_token_key" ON "AuditorAccess"("token");
CREATE UNIQUE INDEX "OrganizationInvite_token_key" ON "OrganizationInvite"("token");
CREATE UNIQUE INDEX "OrganizationInvite_organizationId_email_key" ON "OrganizationInvite"("organizationId", "email");

CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Framework_organizationId_idx" ON "Framework"("organizationId");
CREATE INDEX "Control_frameworkId_idx" ON "Control"("frameworkId");
CREATE INDEX "Control_domain_idx" ON "Control"("domain");
CREATE INDEX "Evidence_controlId_idx" ON "Evidence"("controlId");
CREATE INDEX "Evidence_organizationId_idx" ON "Evidence"("organizationId");
CREATE INDEX "Evidence_type_idx" ON "Evidence"("type");
CREATE INDEX "Policy_organizationId_idx" ON "Policy"("organizationId");
CREATE INDEX "Policy_policyType_idx" ON "Policy"("policyType");
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "RegulationSnippet_frameworkName_idx" ON "RegulationSnippet"("frameworkName");
CREATE INDEX "AuditorAccess_organizationId_idx" ON "AuditorAccess"("organizationId");
CREATE INDEX "AuditorAccess_expiresAt_idx" ON "AuditorAccess"("expiresAt");
CREATE INDEX "OrganizationInvite_expiresAt_idx" ON "OrganizationInvite"("expiresAt");
CREATE INDEX "idx_evidence_embedding_cosine" ON "Evidence" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "idx_snippet_embedding_cosine" ON "RegulationSnippet" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "User"
  ADD CONSTRAINT "User_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Framework"
  ADD CONSTRAINT "Framework_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Control"
  ADD CONSTRAINT "Control_frameworkId_fkey"
  FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "Control"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Evidence"
  ADD CONSTRAINT "Evidence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Policy"
  ADD CONSTRAINT "Policy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "AuditorAccess"
  ADD CONSTRAINT "AuditorAccess_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "OrganizationInvite"
  ADD CONSTRAINT "OrganizationInvite_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
