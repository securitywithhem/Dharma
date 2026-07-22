---
title: Roadmap
folder: 03_PRODUCT
tags: [dharma, product, roadmap, phases]
source_docs: [6_IMPLEMENTATION_PLAN.md, "Future Scope PRD/Implementationplan (absorbed 2026-07-23, source vault since deleted)", packages/db/schema.prisma]
last_updated: 2026-07-23
status: reviewed
---

# Roadmap

## Foundation (documented in `6_IMPLEMENTATION_PLAN.md`)

- [x] **Phase 0 — Core Foundation** (Weeks 1–4): multi-container setup, NextAuth, Prisma (11 core models), framework/control CRUD + seeding, MinIO evidence uploads, SHA-256 audit chaining.
- [x] **Phase 1 — Local AI Integration** (Weeks 5–8): BullMQ + Ollama embedding worker, pgvector similarity search, RAG policy drafting, auditor key portal.
- [ ] **Phase 2 — Enterprise & Hardening** (Weeks 9–12): Docker Compose stabilization, automated backups, E2E validation. Status unconfirmed against `CONTAINERIZATION_STRATEGY.md`/`DEPLOYMENT_RUNBOOK.md` (not yet ingested into this vault).

## Future Scope plan (documented separately — Phase 3b onward)

A second document set — "Dharma Future Scope PRD/TRD/App Flow/Backend Schema/UI-UX/Implementation Plan" — picked up where Phase 2 left off, with an estimated **~24-week (6-month) total timeline from a solid "Phase 3a" base**:

| Phase | Scope | Planned duration | Milestone |
|---|---|---|---|
| 3b | Billing & Subscription (Stripe, `Plan`, entitlement middleware) | 2 weeks | M1: Billing + Marketplace live — Week 5 |
| 3c | Marketplace (`MarketplaceItem`, import/publish/review) | 3 weeks | (same M1) |
| 4 | Cloud connectors (AWS/Azure/GCP/GitHub/Okta/Jira) + automation | 4 weeks | M2: First AWS connector working — Week 9 |
| 5 | Pentest & vulnerability scanning (nuclei-based) | 3 weeks | M3: Automated pentest MVP — Week 12 |
| 6 | Advanced frameworks + cross-walking (`ControlMapping`) | 2 weeks | — |
| 7 | AI Advisor (RAG chat) | 4 weeks | M4: AI advisor beta — Week 16 |
| 8 | Enterprise & white-label (SSO/SCIM/RBAC/MSSP) | 3 weeks | M5: Enterprise ready — Week 19 |
| — | Integration, hardening, testing overlap | +3 weeks | M6: Full platform release — Week 24 |

Explicitly **out of scope** per the Future Scope PRD: on-premise deployment, blockchain-based audit logs, and a built-in pentest execution engine (the plan is to integrate nuclei, not build a scanner from scratch — though see the Part 1 implementation note below on how this was actually built).

Phase 9 ("Bonus" — not in the 24-week estimate) planned: endpoint agent EDR-lite monitoring, advanced reporting, regulatory change monitoring, and a full third-party API.

## What actually shipped vs. what was planned (from the same doc's inline implementation notes)

Unusually, `Implementationplan.md` itself carried real "Part 1 / Part 2 Implementation Notes" for Phase 5 (Pentest), documenting **deviations from its own plan** as they were built — e.g.:
- A dedicated `pentest-worker` container (not the shared worker) holds the host Docker socket, isolating a security-critical blast radius the original brief didn't address.
- Target ownership is attested (`ownershipConfirmed: true`) rather than DNS-TXT-verified — an explicit interim control, flagged as a TODO.
- `AuditLog` (not the planned `AuditEvent`) is the actual audit model — the doc set's `AuditEvent` sketch was never built; `AuditLog` from the original MVP schema was extended instead.
- Embeddings stayed `vector(384)` (Ollama) across every phase, not the Future Scope schema's `vector(1536)` (OpenAI) sketch — see [[Dharma_Master_Context]]'s "local AI, no exceptions" principle.

This pattern — plan documents deviation inline as they're built — is worth continuing. See [[Development_Status]] and [[Feature_Backlog]] for the full phase-by-model mapping against the live schema.

Related: [[MVP_Definition]], [[Feature_Backlog]], [[Development_Status]].
