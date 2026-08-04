---
title: Feature Backlog
folder: 03_PRODUCT
tags: [dharma, product, backlog]
source_docs: [1_PRD.md, 6_IMPLEMENTATION_PLAN.md, "Future Scope PRD (absorbed 2026-07-23, source vault since deleted)", packages/db/schema.prisma]
last_updated: 2026-08-04
status: reviewed
---

# Feature Backlog

Living checklist. PRD-defined MVP features are checked as built (confirmed by matching Prisma models). See [[Dharma_Master_Context]] for the doc-vs-code relationship this reflects, and [[Roadmap]] for the phase timeline.

## PRD Core Features (Section 4) — MVP

- [x] Framework/Control management (DPDP, ISO 27001, SOC 2) — `Framework`, `Control`
- [x] Local AI policy generation (RAG over regulation text) — `RegulationSnippet`, Ollama
- [x] Evidence & artifact management (MinIO) — `Evidence`
- [x] AI-powered evidence-to-control mapping (pgvector) — `Evidence.embedding`
- [x] Compliance dashboard & gap heatmap — `ReadinessScore`, `Recommendation`
- [x] Cryptographic verifiable audit trail (SHA-256 chain) — `AuditLog`, `ChainAnchor`
- [x] Time-limited auditor portal — `AuditorAccess`
- [x] Org & user management, RBAC — `User`, `Role`, `OrganizationInvite`

## Phase 3b–9 (planned in the Future Scope PRD, confirmed built via live schema)

- [x] Multi-tenant billing/subscriptions (Phase 3b) — `Plan`, `ProcessedWebhookEvent`, entitlement middleware, reconciliation + dunning workers
- [x] Provider-agnostic payments with Razorpay live alongside Stripe (Phase 3c) — `PaymentProvider` enum, `src/server/services/payments/*`. **Server-side complete, not signed off**: no live provider test-mode cycle has been run end to end. See [[Billing_And_Payments]]
- [x] Marketplace: publish/discover/import frameworks, reviews, revenue-share-ready reviews (Phase 3c) — `MarketplaceItem`, `MarketplaceReview`, `MarketplaceItemRevision`, `ImportedItem`
- [~] Cloud connectors + auto evidence mapping (Phase 4) — `Connector`, `EvidenceMapping`, `Webhook`, `WebhookDelivery`. Partial: **AWS, GitHub, Okta and Jira have live adapters**; `AZURE` and `GCP` are `null` in `connectorRegistry` and throw "not yet implemented"; `VERCEL` (not in the original plan) has only a legacy Phase 2 sync worker, not an adapter
- [x] Pentest/vulnerability tracking, CVSS scoring, sandboxed nuclei scanner (Phase 5) — `PenTest`, `Vulnerability`, `Asset`
- [x] Advanced frameworks + cross-walking, e.g. SOC2 CC6.1 ↔ ISO27001 A.9.2.1 (Phase 6) — `ControlMapping`, `ReadinessScore`, `Recommendation`
- [x] AI Advisor (RAG chat over org data) — built local-first (`vector(384)`/Ollama), not the Future Scope TRD's OpenAI/`vector(1536)` sketch (Phase 7) — `AIAdvisorSession`, `OrganizationEmbedding`, `IngestedDocument`, `OrgGraphNode`/`OrgGraphEdge`, `AIUsageLog`
- [x] Enterprise SSO (SAML/OIDC) + SCIM + custom RBAC + white-label (Phase 8) — `OrganizationSettings`, `CustomRole`, `@node-saml/node-saml`, `openid-client`
- [x] MSSP multi-org dashboard — built as an explicit revocable allow-list grant, not the Future Scope TRD's "RLS bypass for authorized admin roles" (Phase 8) — `OrganizationGroup`, `MsspGrant`
- [x] Endpoint agent monitoring / EDR-lite (Phase 9 Part 1) — `Endpoint`, `EndpointCheck`
- [x] Advanced/scheduled reporting (Phase 9 Part 2) — `Report`, `ReportSchedule`, `AuditExport`
- [x] Regulatory change monitoring + framework versioning (Phase 9 Part 3) — `FrameworkVersion`, `RegulatoryAlert`
- [x] Full third-party API (Phase 9 Part 3) — `ApiKey`

See [[Roadmap]] for the phase timeline and per-phase implementation deviations, and [[User_Journeys]] for the corresponding flows (still largely undocumented step-by-step — see that note's gap list).
