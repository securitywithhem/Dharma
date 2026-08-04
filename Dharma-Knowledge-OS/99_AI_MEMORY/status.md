---
title: Status
folder: 99_AI_MEMORY
tags: [dharma, ai-memory, status]
source_docs: []
last_updated: 2026-08-04
status: stable
---

# Status

As of 2026-07-23:

- **Vault bootstrap**: `Dharma-Knowledge-OS/` created from `obsidian-vaults/Dharma-Project/` source docs + live `packages/db/schema.prisma`. See [[Dharma_Master_Context]].
- **Product state**: far beyond the original PRD MVP — 48-model schema covering billing, marketplace, connectors, pentest, AI Advisor, enterprise SSO/RBAC, MSSP, endpoint agents (the bootstrap note said 47; the live file had 48). See [[Feature_Backlog]].
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

## 2026-08-04 — knowledge audit; vault re-synced to live code

Full descriptive-claim audit of every node against live code, schema, config and
the canonical test entrypoint. Report: `claude/knowledge-audit-2026-08-04.md`.

**Current state (verified, not inherited from a prior report):** 49 models
(`ProcessedWebhookEvent` added), 31 tRPC routers, 14 BullMQ queues / 16 workers,
17 Docker Compose services. Two subsystems had shipped with no vault node at all
and now have one: [[Billing_And_Payments]] and [[Observability]].

**Corrected in place:** model count (47→49), the `vector(384)` column count
(said six, is five), connectors marked complete when Azure/GCP/Vercel have no
adapter, rate limiting described as a token bucket when it is a fixed-window
in-process `Map`, and four DevOps docs [[Deployment]] listed as existing that do
not exist.

**Prior open items, re-checked:**
- Seed duplicates (ISO 27001 / SOC 2 pairs) — `scripts/seed-frameworks.ts` now
  upserts, and `acf75de` cleaned the dev DB and pointed `envs/.env.test` at
  `dharma_test`. The duplicates were dev-DB data, not a code defect.
- The `--quiet` flag is gone from the PostToolUse hook (now `--skip-flows`), but
  `.claude/settings.json` line 21 still calls `code-review-graph status --json`
  and that flag does not exist — the hook still errors. `detect-changes --brief`
  works. Not fixed here; this audit touched documentation only.
