-- =============================================================================
-- Migration: add_control_embedding.sql
--
-- Adds a pgvector embedding column to the Control table and creates an HNSW
-- index for fast cosine-similarity searches.
--
-- Run: psql $DATABASE_URL -f prisma/migrations/add_control_embedding.sql
-- =============================================================================

-- Ensure pgvector extension is active (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add the 384-dimensional embedding column (nullable until backfilled)
ALTER TABLE "Control"
  ADD COLUMN IF NOT EXISTS embedding vector(384);

-- HNSW index using cosine distance — matches the Evidence index created in
-- add_vector_indexes.sql. HNSW gives sub-millisecond ANN search up to 100k rows.
CREATE INDEX IF NOT EXISTS idx_control_embedding_cosine
  ON "Control"
  USING hnsw (embedding vector_cosine_ops);

-- Partial index so searches only scan rows that have embeddings
-- (skips NULL rows and reduces index size during backfill)
CREATE INDEX IF NOT EXISTS idx_control_embedding_nn
  ON "Control" (id)
  WHERE embedding IS NOT NULL;

-- Status index for efficient filtering by compliance state
CREATE INDEX IF NOT EXISTS idx_control_status
  ON "Control" (status);
