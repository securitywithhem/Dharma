-- =============================================================================
-- Phase 7 Part 1 — AI Advisor data layer
--
-- Adds the document-ingestion / embedding / knowledge-graph tables. The
-- pgvector extension is already created by the init migration; the guard here
-- keeps this file idempotent if applied standalone. Embedding dimension is 384
-- to match every other Dharma pgvector column (Control/Evidence/Vulnerability)
-- and the Ollama `nomic-embed-text` default.
-- =============================================================================

-- Ensure pgvector is available (idempotent — already created in init migration)
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'CHUNKING', 'EMBEDDING', 'GRAPH_EXTRACTING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AIAdvisorSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAdvisorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestedDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "graphNodeCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationEmbedding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "embedding" vector(384),
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgGraphNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "nodeType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgGraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgGraphEdge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgGraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIAdvisorSession_organizationId_userId_idx" ON "AIAdvisorSession"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "IngestedDocument_organizationId_status_idx" ON "IngestedDocument"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationEmbedding_organizationId_documentType_idx" ON "OrganizationEmbedding"("organizationId", "documentType");

-- CreateIndex
CREATE INDEX "OrganizationEmbedding_sourceDocumentId_idx" ON "OrganizationEmbedding"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "OrgGraphNode_organizationId_nodeType_idx" ON "OrgGraphNode"("organizationId", "nodeType");

-- CreateIndex
CREATE INDEX "OrgGraphNode_sourceDocumentId_idx" ON "OrgGraphNode"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "OrgGraphEdge_organizationId_idx" ON "OrgGraphEdge"("organizationId");

-- CreateIndex
CREATE INDEX "OrgGraphEdge_sourceDocumentId_idx" ON "OrgGraphEdge"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "OrgGraphEdge_fromNodeId_idx" ON "OrgGraphEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "OrgGraphEdge_toNodeId_idx" ON "OrgGraphEdge"("toNodeId");

-- AddForeignKey
ALTER TABLE "AIAdvisorSession" ADD CONSTRAINT "AIAdvisorSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAdvisorSession" ADD CONSTRAINT "AIAdvisorSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestedDocument" ADD CONSTRAINT "IngestedDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestedDocument" ADD CONSTRAINT "IngestedDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEmbedding" ADD CONSTRAINT "OrganizationEmbedding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationEmbedding" ADD CONSTRAINT "OrganizationEmbedding_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "IngestedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphNode" ADD CONSTRAINT "OrgGraphNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphNode" ADD CONSTRAINT "OrgGraphNode_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "IngestedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphEdge" ADD CONSTRAINT "OrgGraphEdge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphEdge" ADD CONSTRAINT "OrgGraphEdge_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "IngestedDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphEdge" ADD CONSTRAINT "OrgGraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "OrgGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgGraphEdge" ADD CONSTRAINT "OrgGraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "OrgGraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- pgvector ANN index for cosine similarity on document-chunk embeddings.
-- HNSW to match the existing Evidence/Control/RegulationSnippet indexes
-- (add_vector_indexes.sql / add_control_embedding.sql). Partial index skips
-- NULL rows during the CHUNKING/EMBEDDING window so the operator only scans
-- rows that already have a vector.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "idx_org_embedding_cosine"
  ON "OrganizationEmbedding" USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
