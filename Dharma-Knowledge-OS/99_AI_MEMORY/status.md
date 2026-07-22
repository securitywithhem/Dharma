---
title: Status
folder: 99_AI_MEMORY
tags: [dharma, ai-memory, status]
source_docs: []
last_updated: 2026-07-23
status: stable
---

# Status

As of 2026-07-23:

- **Vault bootstrap**: `Dharma-Knowledge-OS/` created from `obsidian-vaults/Dharma-Project/` source docs + live `packages/db/schema.prisma`. See [[Dharma_Master_Context]].
- **Product state**: far beyond the original PRD MVP — 47-model schema covering billing, marketplace, connectors, pentest, AI Advisor, enterprise SSO/RBAC, MSSP, endpoint agents. See [[Feature_Backlog]].
- **RAG pipeline (Graphify + pgvector wiring)**: **not yet done**. This vault's bootstrap stopped before Section 5 (new `VaultEmbedding` Prisma model, migration, `scripts/ingest-vault.ts`) pending explicit review, since it touches the live schema.
- **Known top gap**: no single doc describes the Phase 2→9 roadmap the schema comments imply — see [[Roadmap]] and [[Development_Status]].

Related: [[progress]], [[decisions]].
