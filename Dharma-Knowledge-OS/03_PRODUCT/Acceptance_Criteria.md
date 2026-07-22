---
title: Acceptance Criteria
folder: 03_PRODUCT
tags: [dharma, product, metrics, performance]
source_docs: [1_PRD.md, 2_TRD.md]
last_updated: 2026-07-23
status: reviewed
---

# Acceptance Criteria

## PRD Success Metrics (Section 5)

- **Zero cloud leaks**: 100% of LLM processing and file storage handled locally (Ollama, MinIO, Postgres). Verifiable by confirming no external AI API calls exist in code, and that `embedding` columns remain `vector(384)` (local model dimension) rather than `vector(1536)` (OpenAI). See [[Dharma_Master_Context]].
- **Fast assessment**: complete initial DPDP self-assessment + policy drafting in <2 hours.
- **API performance**: core page-load API response times <200ms (Next.js SSR + tRPC v11).
- **Verifiable logs**: audit trail cryptographic verification completes in <2 seconds.

## TRD Performance Targets (Section 7)

- tRPC API overhead: <10ms latency
- pgvector search time: <50ms for collections up to 100,000 embeddings
- Ollama generation latency: ~5–15 seconds (hardware-dependent)
- Background worker queue pickup delay: <500ms

## Not in source docs (referenced by master-prompt template, unconfirmed)

The template's cited metrics — "10h/month saved," "AI advisor >80% accuracy," "enterprise deals <2 weeks" — do **not** appear anywhere in the PRD or TRD. These should not be treated as real targets; flagging as a gap rather than fabricating a source.

Related: [[MVP_Definition]], [[System_Architecture]].
