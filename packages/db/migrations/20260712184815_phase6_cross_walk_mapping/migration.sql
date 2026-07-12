-- CreateEnum
CREATE TYPE "MappingStrength" AS ENUM ('EQUIVALENT', 'PARTIAL', 'RELATED');

-- NOTE: Prisma's diff engine wanted to DROP INDEX "Control_path_gin_idx" here.
-- That index isn't expressible in schema.prisma (raw jsonb_path_ops GIN), so it
-- was hand-added as a follow-up statement in the Part 1 migration and Prisma's
-- shadow-DB diff doesn't see a schema declaration for it — a false positive,
-- not a real drop. Intentionally omitted so the Part 1 index survives.

-- AlterTable
ALTER TABLE "Control" ADD COLUMN     "embeddingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "embeddingError" TEXT,
ADD COLUMN     "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastEmbeddingAttempt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ControlMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceControlId" TEXT NOT NULL,
    "targetControlId" TEXT NOT NULL,
    "mappingStrength" "MappingStrength" NOT NULL,
    "rationale" TEXT,
    "suggestedByAI" BOOLEAN NOT NULL DEFAULT false,
    "confidenceScore" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControlMapping_organizationId_sourceControlId_idx" ON "ControlMapping"("organizationId", "sourceControlId");

-- CreateIndex
CREATE INDEX "ControlMapping_organizationId_targetControlId_idx" ON "ControlMapping"("organizationId", "targetControlId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlMapping_organizationId_sourceControlId_targetControl_key" ON "ControlMapping"("organizationId", "sourceControlId", "targetControlId");

-- CreateIndex
CREATE INDEX "Control_embeddingStatus_idx" ON "Control"("embeddingStatus");

-- AddForeignKey
ALTER TABLE "ControlMapping" ADD CONSTRAINT "ControlMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMapping" ADD CONSTRAINT "ControlMapping_sourceControlId_fkey" FOREIGN KEY ("sourceControlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlMapping" ADD CONSTRAINT "ControlMapping_targetControlId_fkey" FOREIGN KEY ("targetControlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 6 Part 2: HNSW index for cosine-similarity AI-suggested cross-walk
-- mappings (suggestMappings()). Reuses the existing Control.embedding column
-- (384-dim, Ollama nomic-embed-text) rather than a separate embedding table —
-- see the comment on Control.embedding in schema.prisma. Matches the naming
-- and "WHERE embedding IS NOT NULL" partial-index convention already used by
-- idx_evidence_embedding_cosine / idx_snippet_embedding_cosine
-- (prisma/migrations/add_vector_indexes.sql). Not expressible via the Prisma
-- schema, so added as a raw follow-up statement.
CREATE INDEX IF NOT EXISTS idx_control_embedding_cosine
  ON "Control" USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
