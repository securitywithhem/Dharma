-- =============================================================================
-- Phase 7 Part 3 — NLP evidence auto-tagging (suggestions only, never applied).
-- Adds AI-suggested cross-control associations to the Evidence model.
-- =============================================================================

-- CreateEnum
CREATE TYPE "AutoTagStatus" AS ENUM ('NONE', 'PROCESSING', 'SUGGESTED', 'ACCEPTED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "Evidence"
    ADD COLUMN "suggestedControlIds" JSONB,
    ADD COLUMN "autoTagConfidence" DOUBLE PRECISION,
    ADD COLUMN "autoTagStatus" "AutoTagStatus" NOT NULL DEFAULT 'NONE';
