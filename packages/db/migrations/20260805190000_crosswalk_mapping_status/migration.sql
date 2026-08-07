-- Cross-walk mapping review state (item 4.2b).
--
-- Bulk machine-proposed mappings must not move the compliance score. Mappings
-- feed readinessScoring's mappingBonus, which grants an UNEVIDENCED control up
-- to full credit when it maps to an EVIDENCED one (EQUIVALENT 1.0, PARTIAL
-- 0.5) — worth up to 15 points. Auto-writing mappings from embedding cosine
-- similarity would therefore change a customer's compliance percentage on
-- output nobody reviewed. This column is what keeps proposals out of scoring
-- until a human accepts them.
--
-- DEFAULT 'ACCEPTED' is deliberate and means NO BACKFILL is needed: every
-- existing row was created by a human through the cross-walk picker, so
-- ACCEPTED is already the truth for all of them, and their scoring behaviour is
-- unchanged by this migration.
--
-- REJECTED is used as a tombstone rather than deleting the row — that is what
-- stops a re-run of proposeForFrameworkPair from re-proposing a pair a human
-- has already turned down.
--
-- Note on the diff: generated with `prisma migrate diff` against the live
-- datasource, NOT via `migrate dev --create-only`. The shadow-DB path emits
-- spurious `DROP INDEX` statements for the hand-added raw indexes
-- ("Control_path_gin_idx", "idx_control_embedding_cosine") because they are not
-- expressible in schema.prisma — see the note in
-- 20260712184815_phase6_cross_walk_mapping/migration.sql. Diffing from the
-- datasource avoids the false positive entirely.

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "ControlMapping" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACCEPTED';

-- CreateIndex
CREATE INDEX "ControlMapping_organizationId_status_idx" ON "ControlMapping"("organizationId", "status");
