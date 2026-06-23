-- ============================================================
-- Dharma – PostgreSQL Initialization Script
-- Runs automatically on first database startup via
-- /docker-entrypoint-initdb.d/01-init-postgres.sql
-- ============================================================

-- Enable pgvector extension for vector similarity search
-- (already bundled in ankane/pgvector image, but idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for full-text fuzzy search (used in compliance search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable btree_gin for composite GIN indexes
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- ============================================================
-- NOTE: Table-level indexes are created AFTER Prisma migrations.
-- The following are pre-migration setup steps only.
-- Post-migration indexes are handled by Prisma schema or a
-- separate migration step.
-- ============================================================

-- Log initialization completion
DO $$
BEGIN
  RAISE NOTICE '✅ Dharma PostgreSQL initialization complete. Extensions enabled: vector, pg_trgm, btree_gin.';
END $$;
