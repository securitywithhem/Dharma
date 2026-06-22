-- ============================================================
-- Migration: add_vector_indexes.sql
-- Adds pgvector HNSW cosine indexes for AI-powered similarity
-- search on Evidence and RegulationSnippet embeddings.
--
-- Run after applying the main Prisma schema migration.
-- Execute via: psql $DATABASE_URL -f prisma/migrations/add_vector_indexes.sql
-- ============================================================

-- Ensure the pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index on Evidence.embedding for fast cosine similarity
-- Only indexes rows that already have an embedding to keep the
-- index lean and avoid NULL comparisons in the operator.
CREATE INDEX IF NOT EXISTS idx_evidence_embedding_cosine
  ON "Evidence" USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- HNSW index on RegulationSnippet.embedding for RAG retrieval
CREATE INDEX IF NOT EXISTS idx_snippet_embedding_cosine
  ON "RegulationSnippet" USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
