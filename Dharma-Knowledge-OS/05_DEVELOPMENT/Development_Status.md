---
title: Development Status
folder: 05_DEVELOPMENT
tags: [dharma, development, status, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, packages/db/schema.prisma, src/server/routers/index.ts, docker-compose.yml, CLAUDE.md]
last_updated: 2026-08-08
status: reviewed
---

# Development Status

## Pivot status (governing framing as of 2026-08-08)

Execution now follows the pivot plan's Phase A–G, not the old Phase 3b–9 numbering. Phase A–G status:

| Phase | Scope | Status |
|---|---|---|
| A | Finish WAVE 0 (pentest ownership verification + SSRF blocklist + scan audit trail) + WAVE 1 (framework-detail crash, dead empty-state CTAs, SSO blank page, Ollama connectivity → build as LLM Provider abstraction instead of a point fix) | **Unconfirmed against `dharma-master-remediation-prompt.md`** — that file was not found at the repo root during this pass (only `LAUNCH_READINESS_REPORT.md` and `PROJECT_UNDERSTANDING_GUIDE.md` are present). Verify WAVE 0/1 completion against the actual remediation doc before assuming Phase A is done. **Do not start Phase B until this is confirmed.** |
| B | Sandbox Manager against one known-safe test app; Agent Runtime + tool system + policy engine; `Finding` model migration + backfill; benchmark harness skeleton (SQLi, IDOR test apps) | Not started |
| C | First vertical slice: Recon → Code → Web/API → Exploit → Validator, scoped to SQLi + IDOR only; confirmed `Finding` → `Evidence` → `Control` status auto-update; gated by benchmark suite (<10% FP target, define exact bar before Phase C exit) | Not started |
| D | Expand vuln classes (Auth Agent, Command Injection, Path Traversal); CLI + GitHub Action; suggested-patch generation | Not started |
| E | Asset & Data Inventory; Knowledge Engine (ASVS, NIST CSF, SOC2, ISO27001, DPDP — versioned/provenance-tracked); rewire Compliance Advisor onto Knowledge Engine + LLM Provider abstraction | Not started |
| F | Risk Engine (`Risk` model, risk register UI, exceptions with mandatory expiry); reconcile Roles-page/Team-membership drift while RBAC is touched for agent tool permissions anyway | Not started |
| G | Trust Center, security questionnaire automation, regulatory change monitoring | Not started — intentionally last |

**Immediate next steps** (pivot plan §8, unchanged order — do not reorder):
1. Confirm/finish WAVE 0 gate (this is the literal prerequisite for the Sandbox Manager's network policy).
2. Write the `Finding` Prisma migration (additive) + backfill script from `Vulnerability`, before any agent code exists.
3. Stand up the `LLMProvider` abstraction while fixing the Ollama connectivity bug — one PR, not two.
4. Create `tests/vulnerable-apps/sqli` and `tests/vulnerable-apps/idor` (minimal deliberately-broken Next.js/Express apps) — needed before Phase C can be graded at all.
5. Only after 1–4: begin Sandbox Manager + Agent Runtime scaffolding (Phase B).

Do not start writing agent prompts or exploit logic before step 4 exists.

## Pre-pivot baseline (verified against live code, 2026-08-04) — for reference, not the current target

This section is retained because the pivot builds *on top of* this baseline, not instead of it. It describes what existed the day before the pivot decision, unchanged by this rewrite.

- **Schema**: 49 models in `packages/db/schema.prisma`. Five `vector(384)` columns.
- **API**: 31 tRPC routers registered in `src/server/routers/index.ts`; REST surfaces at `src/app/api/v1/` (API-key authed), `src/app/api/scim/v2/[orgId]/*`, `src/app/api/sso/{saml,oidc}/[orgId]/*`, two payment webhook receivers.
- **Queues**: 14 BullMQ queues with 16 workers under `src/server/queue/`.
- **Dashboard routes**: `vulnerabilities/`, `pentests/`, `cross-walk/`, `marketplace/`, `mssp/`, `endpoints/`, `reports/`, `regulatory-alerts/`, `settings/enterprise/{sso,roles,white-label,audit-log}`, `settings/billing/`.
- **Existing pentest surface** (`PenTest`, `Vulnerability`, `Asset`, a dedicated `pentest-worker` container holding the Docker socket) is the literal predecessor of the pivot's Sandbox Manager + `Finding` model + Agent Runtime — see [[Database_Design]] for the schema-level relationship and the migration/backfill discipline required before `Vulnerability`/`PenTest` can be deprecated.
- **Existing `Asset` model** is pentest-scoped today. The pivot plan's `Asset` (§4.1: `APPLICATION`/`REPOSITORY`/`API`/`DOMAIN`/`CLOUD_ACCOUNT`/`DATABASE`/`VENDOR`) is broader. **Reconcile these before Phase B** — extend the existing model's `type` enum rather than creating a second `Asset` table. Flag this explicitly in the Phase B implementation prompt.
- Billing Phase 3b/3c (Razorpay + Stripe) is **server-complete, not signed off** — unaffected by the pivot, still an open item. See [[Billing_And_Payments]].
- Observability (Prometheus/Grafana/OTel) shipped and is unaffected by the pivot.
- Rate limiting is fixed-window in-process, not the originally-planned token bucket — unaffected by the pivot but relevant once Agent Runtime tool calls need their own rate limits (see [[Security_Architecture]]).

## Still open (pre-pivot items not resolved by the pivot, folded into Phase B/F backlog per pivot plan §7)

- Billing sign-off (no live provider test-mode cycle run end to end).
- Connector coverage gaps (`AZURE`/`GCP` null adapters; `VERCEL` legacy-only) — re-scoped by the pivot as **evidence collectors feeding the same `Evidence` model**, not a separate track. No new work here until Phase E/connector rewiring.
- ZAP/Burp import (old Phase 5 Part 3) — superseded by the Agent Runtime's `run_external_scan` tool; do not build the standalone importer.
- No deployment runbook / incident-response doc.
- Session revocation, Roles/Team reconciliation, delete-confirmation, data hygiene items from the old WAVE 2–4 backlog — not new work streams, folded into Phase B/F.

Related: [[Roadmap]], [[Feature_Backlog]], [[Progress_Log]], [[Database_Design]], [[Security_Architecture]].
