---
title: System Architecture
folder: 04_TECHNICAL
tags: [dharma, technical, architecture]
source_docs: [2_TRD.md, README.md]
last_updated: 2026-07-23
status: reviewed
---

# System Architecture

## Stack (per TRD Section 1)

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Framer Motion |
| API | tRPC v11 |
| State | Zustand |
| Database | PostgreSQL 15+ + pgvector |
| ORM | Prisma 5.x |
| Queue | Redis + BullMQ |
| Object storage | MinIO |
| Auth | NextAuth.js (+ SAML/OIDC in Phase 8 — see [[Authentication]]) |
| Local AI | Ollama (Llama 3 8B / Mistral) + LangChain.js |
| Deployment | Docker Compose |
| CI | GitHub Actions + Playwright |

## Request flow

```
User Browser → Caddy (TLS) → Next.js (tRPC gateway + SSR)
                                ├── Prisma → PostgreSQL + pgvector
                                ├── Presigned URLs → MinIO (evidence files)
                                └── Redis (BullMQ) → Worker process → Ollama
```

- **tRPC gateways**: types flow directly from Prisma to frontend components — no REST boilerplate, no schema drift between client/server.
- **Object storage**: files never transit the Next.js server. Client requests a presigned MinIO URL via tRPC, then PUTs directly to MinIO — avoids body-size limits and keeps the API responsive. See [[User_Journeys]] Journey 1.
- **Background worker**: anything slow (SHA-256 chaining, OCR, Ollama calls) goes through BullMQ on Redis, keeping API routes under the TRD's <200ms p95 target.

## Local AI / RAG pipeline (TRD Section 5)

1. Source text (e.g. DPDP Act 2023) is chunked (~500 chars, 100-char overlap).
2. Chunks are embedded via Ollama and stored (`RegulationSnippet.embedding`, `vector(384)`).
3. On policy generation, pgvector cosine-similarity search retrieves relevant sections.
4. Retrieved snippets are injected into a structured prompt template and sent to local Llama 3.

This same pattern is reused, per the schema's own comments, for `Control.embedding` (cross-walk suggestions), `Vulnerability.embedding`, and `OrganizationEmbedding` (AI Advisor) — one embedding convention across the whole product. See [[Database_Design]].

## Performance targets (TRD Section 7)

- tRPC overhead <10ms
- pgvector search <50ms up to 100k embeddings
- Ollama generation ~5–15s
- BullMQ pickup delay <500ms

Related: [[Database_Design]], [[Deployment]], [[Security_Architecture]].
