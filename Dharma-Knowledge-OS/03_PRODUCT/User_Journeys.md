---
title: User Journeys
folder: 03_PRODUCT
tags: [dharma, product, journeys, ux, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, 3_APP_FLOW.md]
last_updated: 2026-08-08
status: reviewed
---

# User Journeys

## Flagship journey (new — replaces "Connecting AWS for Automated Evidence" as the primary flow)

**6. Connect App → Sandboxed Scan → Agent Findings → Evidence Auto-Linked → Compliance Score Moves**

`/dashboard/assets` → "Connect Application" → repo URL + optional running-instance URL → ownership verification (DNS TXT / HTTP-file challenge — same `VerifiedAsset` mechanism as the existing pentest module, generalized) → `AgentRun` created, dispatched into Sandbox Manager → Recon Agent fingerprints stack/routes → Code Agent flags hypotheses (never confirmed at this stage) → Web/API Agent probes live endpoints → Exploit Agent attempts reproduction (SQLi/IDOR in the first vertical slice) → Validator Agent independently tries to disprove → on survival, `Finding` created (`status: CONFIRMED`) → `Evidence` auto-generated and linked → linked `Control.status` updates → `ReadinessScore` recalculates. Every step writes to `AgentRun.toolCalls` and the dedicated scan/exploit authorization log. Human approval gate before any suggested patch is shown as actionable. See [[Database_Design]] (`Finding`, `Asset`, `AgentRun`), [[Security_Architecture]] (§5 non-negotiables).

The old "Connecting AWS for Automated Evidence" flow (cloud connector → `EvidenceMapping`) still exists as a **secondary** evidence source, re-scoped to feed the same `Evidence` model rather than being a separate track — see [[Feature_Backlog]] Phase E.

## Documented pre-pivot flows (kept, unaffected by the pivot)

1. **Evidence Upload → AI Mapping**: `/dashboard/evidence` → upload modal → presigned MinIO URL → direct PUT upload → `evidence.create` → BullMQ `process-evidence` job → Ollama summary + embedding → status `pending`→`analyzed`. Now one of two evidence sources (manual vs. agent) into the same table — see [[Database_Design]] (`Evidence`), [[API_Design]].
2. **AI Evidence-to-Control Mapping**: `/dashboard/evidence/[id]` → `evidence.getAIRecommendations` (pgvector cosine similarity) → top-3 suggestions with match % → user clicks "Map to Control" → `control.linkEvidence` → `AuditLog` entry appended. See [[SOC_2]], [[ISO_27001]].
3. **AI Policy Generation (RAG)**: `/dashboard/policies/new` → context Q&A → `policy.triggerAIGeneration` → pgvector retrieves `RegulationSnippet`s → BullMQ `generate-policy` job → drafts markdown via the `LLMProvider` (Ollama default) → TipTap review/edit → publish → `AuditLog` entry. See [[GDPR]], [[System_Architecture]].
4. **Audit Log Verification**: Dashboard/Settings → "Verify Log Integrity" → `audit.verifyIntegrity` recomputes SHA-256 chain → valid (green ShieldCheck) or broken-at-ID (red ShieldAlert). See [[Audit_Process]], [[Security_Architecture]].
5. **Time-Limited Auditor Portal**: Settings → "Generate Auditor Link" → duration select → `settings.createAuditorKey` → JWT + `AuditorAccess` row → shareable URL → auditor sees read-only view with countdown banner. See [[Authentication]].

## Undocumented flows (built, no step-by-step doc — gap, and now re-scoped by the pivot)

7. **Marketplace Import**: framework/control discovery and import via `MarketplaceItem`/`ImportedItem`. Commerce layer discarded; import-only flow still undocumented — low priority.
8. **Cloud Connector Setup (e.g. AWS)**: `Connector` config → `EvidenceMapping` auto-population. Now a secondary evidence source (see flagship journey above). No documented flow.
9. **Pentest Request**: `PenTest`/`Vulnerability`/`Asset` lifecycle. **Being replaced** by journey 6 above — do not write new documentation for this flow, document journey 6 instead as it lands.
10. **AI Advisor Chat**: `AIAdvisorSession` RAG chat over `OrganizationEmbedding`/`IngestedDocument`. Will be rewired onto the Knowledge Engine in Phase E — defer documentation until that lands.
11. **Enterprise SSO / White-Label Setup**: SAML/OIDC config via `OrganizationSettings`. No documented flow; unaffected by pivot.
12. **MSSP Dashboard**: multi-org oversight via `MsspGrant`. Parked as a roadmap item; no documented flow, none planned near-term.

Related: [[Requirements]], [[Feature_Backlog]], [[Roadmap]].
