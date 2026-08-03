---
title: Dharma Master Context
folder: 00_START_HERE
tags: [dharma, overview, context, second-brain]
source_docs: [README.md, 1_PRD.md, 2_TRD.md, 6_IMPLEMENTATION_PLAN.md, "Future Scope PRD/TRD/Appflow/BackendSchema/UI-UX/Implementationplan (absorbed 2026-07-23, source vault since deleted)", packages/db/schema.prisma]
last_updated: 2026-08-04
status: reviewed
---

# Dharma — Master Context

Read this note first in any new session. It is the single-page synthesis of what Dharma is, where it actually stands, and where the source docs disagree with the live codebase.

## Identity

Dharma is a self-hosted, open-source **GRC (governance, risk, compliance) platform**, originally scoped for Indian MSMEs and startups needing DPDP Act 2023, ISO 27001, and SOC 2 compliance without leaking sensitive data to cloud AI vendors. See [[Vision]] and [[Problem_Statement]].

## Core value proposition

- **Zero-cloud AI**: embeddings and generation run locally via Ollama (`nomic-embed-text`, Llama 3), confirmed by the live schema still using `vector(384)` — the local embedding dimension, not OpenAI's 1536. See [[Database_Design]].
- **Tamper-evident audit log**: SHA-256 hash-chained `AuditLog` rows, verifiable end-to-end. See [[Security_Architecture]].
- **Self-hosted stack**: Next.js 14 + tRPC v11 + Prisma + PostgreSQL/pgvector + Redis/BullMQ + MinIO + Ollama, all via Docker Compose. See [[System_Architecture]].

## Actual current stage (not what the original MVP PRD says)

The numbered planning docs (`1_PRD.md`–`6_IMPLEMENTATION_PLAN.md`) describe a **single-tenant, 11-model MVP** with PRD Section 6 explicitly marking multi-tenant SaaS, cloud connectors, and pentest scanning as **out of scope for "Phase 1."**

There was a second, distinctly-named document set — "Dharma Future Scope – PRD/TRD/App Flow/Backend Schema/UI-UX/Implementation Plan" — that picked up exactly where the MVP PRD's Section 6 left off, planning Phase 3b through Phase 9 (billing, marketplace, connectors, pentest, cross-walking, AI advisor, enterprise/white-label, MSSP). These lived in `obsidian-vaults/Dharma-Project/` under unnumbered filenames (`PRD.md`, `TRD.md`, `Appflow.md`, `BackendSchema.md`, `UI:UX.md`, `Implementationplan.md`) — that vault has since been deleted (its content is absorbed into this vault and remains in git history); see [[Roadmap]] for the full phase breakdown now sourced from it.

The live schema (`packages/db/schema.prisma`) has **49 models**, closely matching that Future Scope spec but with real, documented deviations (e.g. embeddings stay `vector(384)`/Ollama, not the spec's `vector(1536)`/OpenAI; `AuditLog` not `AuditEvent`; MSSP cross-tenant access uses an explicit revocable `MsspGrant` allow-list, not a role-based RLS bypass). It includes everything the Future Scope docs planned, plus a few things neither doc set mentions:
- Billing/plans (`Plan`, `ProcessedWebhookEvent`) — provider-agnostic across Stripe and Razorpay; see [[Billing_And_Payments]]
- Marketplace (`MarketplaceItem`, `MarketplaceReview`, `MarketplaceItemRevision`, `ImportedItem`)
- Cloud connectors (`Connector`, `EvidenceMapping`, `Webhook`, `WebhookDelivery`)
- Pentest/vuln management (`PenTest`, `Vulnerability`, `Asset`)
- AI Advisor / RAG (`AIAdvisorSession`, `OrganizationEmbedding`, `IngestedDocument`, `OrgGraphNode`, `OrgGraphEdge`, `AIUsageLog`)
- Enterprise/white-label + SSO (`OrganizationSettings`, SAML via `@node-saml/node-saml`, OIDC via `openid-client`)
- RBAC (`CustomRole`, `OrganizationGroup`)
- MSSP multi-org management (`MsspGrant`)
- Endpoint agent monitoring (`Endpoint`, `EndpointCheck`) — this is Future Scope PRD's "Phase 9 (Bonus)" EDR-lite item, built as "Phase 9 Part 1"
- Reporting (`Report`, `ReportSchedule`) — Future Scope's "Phase 9" advanced reporting, built as "Phase 9 Part 2"
- Framework versioning (`FrameworkVersion`), regulatory alerts (`RegulatoryAlert`) — Future Scope's "Phase 9" regulatory monitoring, built as "Phase 9 Part 3", alongside `ApiKey` (Future Scope's "full API for third-party integrations")

**Treat both PRD document sets as the founding vision, not current-state docs.** For current state, trust the live schema and [[Development_Status]]; for the *documented* plan (as opposed to what the schema implies), see [[Roadmap]] and [[Feature_Backlog]].

## Core modules (as actually built)

1. Framework/Control tracking (DPDP, ISO 27001, SOC 2, extensible via `FrameworkVersion`)
2. Evidence management with pgvector-backed AI mapping
3. Policy drafting via local RAG (Ollama + `RegulationSnippet`)
4. Cryptographic audit trail (SHA-256 hash chain)
5. Multi-tenant billing (`Plan`) behind a provider-agnostic payment interface — Razorpay is the live provider, Stripe is retained; see [[Billing_And_Payments]]
6. Marketplace for frameworks/controls
7. Cloud connectors + evidence auto-mapping
8. Pentest/vulnerability tracking
9. AI Advisor (RAG chat over org data)
10. Enterprise SSO/SCIM, custom RBAC, white-label
11. MSSP dashboard (multi-org oversight)
12. Endpoint agent monitoring

## Frameworks supported

DPDP Act 2023, ISO 27001:2022, SOC 2 Type II — see [[ISO_27001]] and [[SOC_2]], cross-walked via `ControlMapping` (e.g. SOC2 CC6.1 ↔ ISO27001 A.9.2.1).

## Where to go next

- Product vision → [[Vision]], [[Mission]], [[Product_Principles]]
- Full feature/phase breakdown → [[Feature_Backlog]], [[Roadmap]]
- Schema detail → [[Database_Design]]
- Billing/payments (two providers, entitlements, dunning) → [[Billing_And_Payments]]
- Metrics, dashboards, tracing → [[Observability]]
- Current build status → [[Development_Status]]
