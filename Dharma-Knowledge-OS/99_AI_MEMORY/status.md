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

## 2026-07-30 — Dashboard redesign landed; three seed defects open

`/dashboard` rebuilt structurally (Warm Paper palette unchanged). New:
`ProgressRing`, `SeverityBadge`/`GapBadge`, `EmptyState`, `Card` density/variant
props, `FrameworkStatusCard`, `ActionItemRow`, `lib/compliance/severity.ts`.
`FrameworkProgressCards.tsx` deleted. Tests: 59 jest + 7 new e2e green;
`tests/e2e/dashboard.a11y.spec.ts` enforces colour-contrast and 390/834/1440
overflow, and caught a real mobile overflow (grid `min-width:auto` + a `-mx-2`
bleed wider than its container).

**Open — seed data, not UI:**
1. Duplicate ISO 27001 pair: `ISO 27001` (v2022, 4 controls) vs `ISO 27001:2022`
   (v1.0, 24 controls).
2. Duplicate SOC 2 pair: `SOC 2` (Type II, **0 controls**) vs `SOC 2 Type II`
   (v1.0, 28 controls). The empty one renders a card with no data.
3. Four of the top five action items are titled literally `Test Control`.

**Open — tooling, blocks the documented review step:**
- `code-review-graph update` crashes: `sqlite3.OperationalError: cannot start a
  transaction within a transaction` (graph.py:239). The graph is stale at
  `9d28729` and still reports functions that no longer exist. The PostToolUse
  hook also passes an unsupported `--quiet` flag and fails on every tool call.
