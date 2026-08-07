-- WAVE 7 — policy lifecycle (fullstack-audit-2026-08-06 §4 CRITICAL).
--
-- The Policies module had no detail route and no update/publish/delete
-- mutation: `isPublished` was settable only at create time, so a generated
-- policy could never be opened, edited, reviewed, published, exported or
-- deleted again. This adds the two columns that lifecycle needs.
--
-- Both are nullable with no default, so every existing row is unaffected:
-- existing policies keep whatever isPublished they were created with and are
-- treated as never-explicitly-published (publishedAt NULL) and not deleted.

-- When the current version became the published policy. Distinct from
-- updatedAt, which moves on every edit — see the schema comment.
ALTER TABLE "Policy" ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Soft delete. A policy that was ever published is an attestable artifact, and
-- the hash-chained AuditLog rows referencing this id are immutable, so the row
-- must outlive the user's decision to remove it from their working list.
ALTER TABLE "Policy" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Every list query is "this org's live policies".
CREATE INDEX "Policy_organizationId_deletedAt_idx" ON "Policy" ("organizationId", "deletedAt");
