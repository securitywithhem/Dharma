---
title: Development Status
folder: 05_DEVELOPMENT
tags: [dharma, development, status]
source_docs: [6_IMPLEMENTATION_PLAN.md, "Future Scope Implementationplan (absorbed 2026-07-23, source vault since deleted)", packages/db/schema.prisma, src/server/routers/index.ts, src/app/dashboard/, docker-compose.yml, CLAUDE.md]
last_updated: 2026-08-04
status: reviewed
---

# Development Status

## Verified against live code, 2026-08-04

Every line in this section was confirmed by reading the repo, not by reading another doc.

- **Schema**: 49 models in `packages/db/schema.prisma` (was 48 at the 2026-07-23 vault bootstrap; `ProcessedWebhookEvent` is the addition). Five `vector(384)` columns.
- **API**: 31 tRPC routers registered in `src/server/routers/index.ts`; REST surfaces at `src/app/api/v1/` (API-key authed), `src/app/api/scim/v2/[orgId]/*`, `src/app/api/sso/{saml,oidc}/[orgId]/*`, and two payment webhook receivers.
- **Queues**: 14 BullMQ queues with 16 workers under `src/server/queue/`.
- **Dashboard routes**: every Phase 5–9 surface has a page — `vulnerabilities/`, `pentests/`, `cross-walk/`, `marketplace/`, `mssp/`, `endpoints/`, `reports/`, `regulatory-alerts/`, `settings/enterprise/{sso,roles,white-label,audit-log}`, `settings/billing/`.
- **Two open questions from the previous revision are now answered.** Phase 5 Part 3's **vulnerability management UI is built** (`src/app/dashboard/vulnerabilities/` with a triage board and swim lanes, per `64e20b1`); its **ZAP/Burp import is not** — no ZAP or Burp parser exists anywhere in `src/`. Phase 9 Parts 1–3 are built end-to-end (endpoint agent, reporting, regulatory monitoring + `ApiKey`), UI included.
- **Newest work (2026-08-03), not present at the 2026-07-23 bootstrap**: billing Phase 3b (webhook idempotency, entitlement enforcement, reconciliation + dunning workers) and Phase 3c (provider-agnostic payments, Razorpay live alongside Stripe). See [[Billing_And_Payments]] — **server-complete but not signed off**, since no live provider test-mode cycle has been run.
- **Observability shipped** as part of the same window: Prometheus, Grafana, OpenTelemetry collector and three exporters in `docker-compose.yml`. See [[Observability]].
- **Not built, despite being described in [[System_Architecture]] as a target**: nothing found contradicting the documented stack, but rate limiting is a fixed-window in-process limiter rather than the TRD's token bucket — see [[Security_Architecture]].

## Historical assessment (2026-07-23, retained)

As of 2026-07-23:

- **Phase 0 (Core Foundation)**: complete. Confirmed by live schema — `Organization`, `User`, `Framework`, `Control`, `Evidence`, `Policy`, `AuditLog` all present with the shape described in the Week 1–4 plan.
- **Phase 1 (Local AI Integration)**: complete. `vector(384)` embeddings on `Evidence`/`RegulationSnippet`, confirming Ollama-based RAG is live, not just planned.
- **Phase 2 and beyond**: the schema's own inline phase comments (`// Phase 2 Feature 2: Automated Evidence Connectors`, `// Phase 8 Part 1 — Enterprise SSO / SCIM / RBAC`, etc.) show continuous build-out through at least "Phase 9 Part 3," matching the separately-planned "Future Scope" roadmap (Phase 3b–9) almost model-for-model — see [[Roadmap]] for the full phase timeline and [[Feature_Backlog]] for the model-by-phase mapping.
- This project's `CLAUDE.md` directs all code exploration through a `code-review-graph` MCP knowledge graph rather than raw file search — a sign of an actively maintained, tooled-up codebase, not an early-stage MVP.
- Notably, **Phase 5 (Pentest) has real, dated implementation notes** (Parts 1 and 2, migrations `20260711143208_phase5_pentest_vulnerability_models` and `20260711152443_phase5_part2_vuln_enrichment`) documenting deviations from the original Future Scope spec as they were built — e.g. a dedicated `pentest-worker` container for Docker-socket isolation, and CVSS scoring via `ae-cvss-calculator`. Part 3 (vulnerability management UI, ZAP/Burp import) was explicitly deferred and its status is unconfirmed here.

## Resolved: the Phase 3–9 roadmap does have a source doc

An earlier version of this vault noted no single doc covered Phase 3–9. That was wrong — a distinct "Dharma Future Scope" document set (PRD/TRD/App Flow/Backend Schema/UI-UX/Implementation Plan) covered exactly that, just under unnumbered filenames in `obsidian-vaults/Dharma-Project/`, which has since been absorbed into this vault and deleted (recoverable via git history). See [[Roadmap]] for the full timeline this correction is based on.

## Still open

- **Billing sign-off.** Both payment providers are wired and unit-tested, but neither Stripe test mode nor Razorpay Test Mode has been driven through a full subscribe → invoice → fail → dun → cancel cycle against the live API. Until that happens, "billing works" is a code claim, not an operational one. See [[Billing_And_Payments]].
- **Connector coverage.** `AZURE` and `GCP` are `null` in the adapter registry; `VERCEL` has only a legacy sync worker. [[Feature_Backlog]] previously marked this row complete and no longer does.
- **ZAP/Burp import** (Phase 5 Part 3's remaining half) is unbuilt.
- **No deployment runbook.** The four DevOps docs an earlier revision of [[Deployment]] listed as existing do not exist; there is no restore procedure for the `backup-scheduler`, and no incident-response doc for [[Threat_Model]] to point at.

Related: [[Roadmap]], [[Feature_Backlog]], [[Progress_Log]], [[Billing_And_Payments]], [[Observability]].
