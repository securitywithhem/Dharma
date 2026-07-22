---
title: Database Design
folder: 04_TECHNICAL
tags: [dharma, technical, database, prisma, pgvector]
source_docs: [packages/db/schema.prisma, 5_BACKEND_SCHEMA.md]
last_updated: 2026-07-23
status: reviewed
---

# Database Design

PostgreSQL + `pgvector` extension (`extensions = [pgvector(map: "vector")]`), Prisma ORM. This note transcribes the **live schema** (`packages/db/schema.prisma`, 47 models), organized by the phase comments already present in the file — which makes this schema unusually self-documenting about its own build history and deviations from `obsidian-vaults/Dharma-Project/5_BACKEND_SCHEMA.md`.

**pgvector dependency**: six columns use `Unsupported("vector(384)")` — `Control.embedding`, `Evidence.embedding`, `RegulationSnippet.embedding`, `Vulnerability.embedding`, `OrganizationEmbedding.embedding`. All are 384-dimensional (Ollama `nomic-embed-text`), **not** 1536 (OpenAI) — confirms [[Dharma_Master_Context]]'s "local AI, no exceptions" principle. This is the exact pattern any new vault-embedding table (see the RAG-wiring section of this vault's bootstrap) should follow: raw SQL writes via `$1::vector`, since Prisma has no native vector type.

## Foundation (Phase 0–1, matches original PRD scope)

- **`Organization`** — tenant root; owns nearly every other model by `organizationId`.
- **`User`** / **`Account`** / **`Session`** / **`VerificationToken`** — NextAuth-compatible identity. `Role` enum: `ADMIN`, `COMPLIANCE_MANAGER`, `VIEWER`, `PUBLISHER`.
- **`Framework`** → **`Control`** (domain-scoped, self-referential hierarchy via `parentId`/`path`/`depth` for arbitrary-depth control families like NIST 800-53's `AC-2(1)`).
- **`Evidence`** — MinIO file pointer + `vector(384)` embedding + `embeddingStatus` lifecycle (`PENDING`/`SUCCESS`/`FAILED`).
- **`Policy`** — versioned markdown/TipTap content.
- **`AuditLog`** — SHA-256 hash-chained (`previousHash`/`currentHash`). See [[Audit_Process]], [[Security_Architecture]].
- **`RegulationSnippet`** — RAG source material (DPDP Act chunks).
- **`AuditorAccess`** — time-limited, token-hashed read-only access.
- **`OrganizationInvite`** — email invite flow with expiry.

## Phase 2 — Connectors, chain anchoring, policy templates, exports

- **`ChainAnchor`** — periodically anchors the audit-log hash chain externally (OpenTimestamps `.ots` receipt support) so integrity doesn't rely solely on the DB itself.
- **`Connector`** (`ConnectorType`: AWS/AZURE/GCP/GITHUB/OKTA/JIRA/VERCEL) + **`EvidenceMapping`** — auto-collect evidence on a schedule.
- **`Webhook`** / **`WebhookDelivery`** — outgoing webhook dispatch with AES-256-GCM secret storage.
- **`PolicyTemplate`** — Handlebars-templated policy generation.
- **`AuditExport`** — signed export packages with 24h presigned expiry.

## Phase 3c — Marketplace

**`MarketplaceItem`** (types: FRAMEWORK/TEMPLATE/CONNECTOR) → **`MarketplaceReview`**, **`MarketplaceItemRevision`**, **`ImportedItem`**. See [[Security_Control_Frameworks]] for how this feeds framework import.

## Phase 5 — Pentest & vulnerability management

**`PenTest`** (EXTERNAL_NETWORK/WEB_APP, cron-schedulable) → **`Vulnerability`** (CVSS score + vector string, `vector(384)` embedding) → optional **`Asset`** registry. `Vulnerability.controlId` links a finding back to the control it violates.

## Phase 6 — Cross-walking & readiness scoring

- **`ControlMapping`** — the cross-walk table (`MappingStrength`: EQUIVALENT/PARTIAL/RELATED), AI-suggestible via `Control.embedding` similarity. This is the model backing the SOC2 CC6.1 ↔ ISO27001 A.9.2.1 example — see [[SOC_2]], [[ISO_27001]].
- **`ReadinessScore`** / **`Recommendation`** — computed gap-heatmap data. See [[Risk_Management]].

## Phase 7 — AI Advisor data layer

**`AIAdvisorSession`** (chat history) → **`OrganizationEmbedding`** (per-org, tenant-isolated RAG chunks, sourced from **`IngestedDocument`**) → **`OrgGraphNode`**/**`OrgGraphEdge`** (per-org knowledge graph — deliberately Postgres-backed rather than a dedicated graph DB, per the schema's own comment, to keep the tenant-isolation boundary simple). **`AIUsageLog`** tracks token spend against `Plan.limits.aiTokensPerMonth`. **`Evidence.suggestedControlIds`** (Phase 7 Part 3 auto-tagging) is explicitly suggestion-only — never auto-applied, preserving audit integrity.

## Phase 8 — Enterprise SSO/SCIM/RBAC + MSSP

- **`OrganizationSettings`** — SSO config (SAML/OIDC via `ssoConfig` Json), SCIM (`scimTokenHash`, hashed not encrypted), white-label (`whiteLabel` Json: logo/color/custom domain), SIEM export target.
- **`CustomRole`** — permissions-as-JSON RBAC, with `User.customRoleId` falling back to the legacy `Role` enum when null (zero-downtime migration path).
- **`OrganizationGroup`** + **`MsspGrant`** — MSSP parent-org grouping with an explicit, revocable, time-boxable allow-list of client org IDs (deliberately not "role == MSSP admin ⇒ bypass tenant isolation"). See [[Threat_Model]].

## Phase 9 — Endpoint agent, reporting, regulatory monitoring, API

- **`Endpoint`** (enrollment token stored as SHA-256 hash, never plaintext) → **`EndpointCheck`** (disk encryption, patch level, screen lock, firewall — optionally mapped to a `Control`).
- **`Report`** / **`ReportSchedule`** — async PDF generation (CUSTOM_PDF, BOARD_SUMMARY), never in a request thread.
- **`FrameworkVersion`** → **`RegulatoryAlert`** — diffs control trees between marketplace framework versions, fans out per-org alerts.
- **`ApiKey`** — third-party API credentials, SHA-256 hashed.

## Billing

**`Plan`** (free/pro/enterprise, Stripe-linked) ← **`Organization`** (`stripeCustomerId`, `subscriptionStatus`, `subscriptionEndsAt`).

Related: [[System_Architecture]], [[Security_Architecture]], [[Authentication]], [[Authorization]], [[Feature_Backlog]].
