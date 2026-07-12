-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('MISSING_EVIDENCE', 'STALE_EVIDENCE', 'UNMAPPED_HIGH_VALUE_CONTROL', 'FAMILY_LOW_COVERAGE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DISMISSED', 'RESOLVED');

-- NOTE: Prisma's diff engine wanted to DROP INDEX "Control_path_gin_idx" here —
-- the same false positive documented in the Part 2 migration (the raw
-- jsonb_path_ops GIN index isn't expressible in schema.prisma, so Prisma's
-- shadow-DB diff doesn't see a schema declaration for it). Intentionally
-- omitted so the Part 1 index survives.

-- CreateTable
CREATE TABLE "ReadinessScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "evidenceScore" DOUBLE PRECISION NOT NULL,
    "mappingBonus" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "controlId" TEXT,
    "type" "RecommendationType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "potentialScoreGain" DOUBLE PRECISION,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadinessScore_organizationId_frameworkId_computedAt_idx" ON "ReadinessScore"("organizationId", "frameworkId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessScore_organizationId_frameworkId_key" ON "ReadinessScore"("organizationId", "frameworkId");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_frameworkId_status_idx" ON "Recommendation"("organizationId", "frameworkId", "status");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_frameworkId_potentialScoreGai_idx" ON "Recommendation"("organizationId", "frameworkId", "potentialScoreGain");

-- AddForeignKey
ALTER TABLE "ReadinessScore" ADD CONSTRAINT "ReadinessScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessScore" ADD CONSTRAINT "ReadinessScore_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
