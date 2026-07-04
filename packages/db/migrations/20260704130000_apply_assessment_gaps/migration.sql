-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- DropIndex
DROP INDEX "AuditorAccess_token_key";

-- DropIndex
DROP INDEX IF EXISTS "idx_evidence_embedding_cosine";

-- DropIndex
DROP INDEX IF EXISTS "idx_snippet_embedding_cosine";

-- AlterTable
ALTER TABLE "AuditorAccess" DROP COLUMN "token",
ADD COLUMN     "exchangedAt" TIMESTAMP(3),
ADD COLUMN     "sessionTokenHash" TEXT,
ADD COLUMN     "tokenHash" TEXT;

-- AlterTable
ALTER TABLE "Connector" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Control" ADD COLUMN     "embedding" vector(384);

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "embeddingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "embeddingError" TEXT,
ADD COLUMN     "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastEmbeddingAttempt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lockKeyId" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AuditorAccess_tokenHash_key" ON "AuditorAccess"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditorAccess_sessionTokenHash_key" ON "AuditorAccess"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "Control_status_idx" ON "Control"("status");

-- CreateIndex
CREATE INDEX "Evidence_embeddingStatus_idx" ON "Evidence"("embeddingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_lockKeyId_key" ON "Organization"("lockKeyId");
