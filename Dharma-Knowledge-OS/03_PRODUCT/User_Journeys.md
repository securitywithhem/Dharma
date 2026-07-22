---
title: User Journeys
folder: 03_PRODUCT
tags: [dharma, product, journeys, ux]
source_docs: [3_APP_FLOW.md]
last_updated: 2026-07-23
status: reviewed
---

# User Journeys

The 3_APP_FLOW.md doc details 5 core workflows for the original MVP scope. The master-prompt template additionally names Marketplace Import, AWS Connector, Pentest Request, AI Advisor, Enterprise SSO/White-Label, and MSSP Dashboard as flows — those exist as built features (see [[Feature_Backlog]]) but have no documented step-by-step flow in the source docs; they're listed below as gaps.

## Documented flows (from 3_APP_FLOW.md)

1. **Evidence Upload → AI Mapping**: `/dashboard/evidence` → upload modal → presigned MinIO URL → direct PUT upload → `evidence.create` → BullMQ `process-evidence` job → Ollama summary + embedding → status `pending`→`analyzed`. See [[Database_Design]] (`Evidence`), [[API_Design]].
2. **AI Evidence-to-Control Mapping**: `/dashboard/evidence/[id]` → `evidence.getAIRecommendations` (pgvector cosine similarity) → top-3 suggestions with match % → user clicks "Map to Control" → `control.linkEvidence` → `AuditLog` entry appended. See [[SOC_2]], [[ISO_27001]] for the cross-walk this enables.
3. **AI Policy Generation (RAG)**: `/dashboard/policies/new` → context Q&A → `policy.triggerAIGeneration` → pgvector retrieves `RegulationSnippet`s → BullMQ `generate-policy` job → Llama 3 drafts markdown → TipTap review/edit → publish → `AuditLog` entry. See [[GDPR]] (DPDP RAG), [[System_Architecture]].
4. **Audit Log Verification**: Dashboard/Settings → "Verify Log Integrity" → `audit.verifyIntegrity` recomputes SHA-256 chain → valid (green ShieldCheck) or broken-at-ID (red ShieldAlert). See [[Audit_Process]], [[Security_Architecture]].
5. **Time-Limited Auditor Portal**: Settings → "Generate Auditor Link" → duration select → `settings.createAuditorKey` → JWT + `AuditorAccess` row → shareable URL → auditor sees read-only view with countdown banner. See [[Authentication]].

## Undocumented flows (built, no step-by-step doc — gap)

6. **Marketplace Import**: framework/control discovery and import via `MarketplaceItem`/`ImportedItem`. No documented flow.
7. **Cloud Connector Setup (e.g. AWS)**: `Connector` config → `EvidenceMapping` auto-population. No documented flow.
8. **Pentest Request**: `PenTest`/`Vulnerability`/`Asset` lifecycle. No documented flow.
9. **AI Advisor Chat**: `AIAdvisorSession` RAG chat over `OrganizationEmbedding`/`IngestedDocument`. No documented flow.
10. **Enterprise SSO / White-Label Setup**: SAML/OIDC config via `OrganizationSettings`. No documented flow.
11. **MSSP Dashboard**: multi-org oversight via `MsspGrant`. No documented flow.

Related: [[Requirements]], [[Feature_Backlog]].
