---
title: API Design
folder: 04_TECHNICAL
tags: [dharma, technical, api, trpc]
source_docs: [5_BACKEND_SCHEMA.md, 2_TRD.md]
last_updated: 2026-07-23
status: reviewed
---

# API Design

All internal APIs are tRPC v11 procedures; org ID is pulled from session context, never a client-supplied parameter, to prevent cross-tenant leaks (enforced at the query layer — see [[Authorization]]).

## Documented routers (5_BACKEND_SCHEMA.md Section 4)

- **`framework`**: `list`, `getById`, `create` (triggers control seeding).
- **`control`**: `getById`, `updateStatus` (triggers `AuditLog` entry).
- **`evidence`**: `getUploadUrl` (presigned MinIO URL), `create` (enqueues BullMQ mapping job), `list`, `getAIRecommendations` (pgvector top-3 similarity).
- **`policy`**: `list`, `create`, `triggerAIGeneration` (returns `{ jobId }`, client polls `job.getStatus`).
- **`audit`**: `list`, `verifyIntegrity` (returns `{ isValid, brokenLogId, calculatedCount }`).

## Undocumented but implied by the live schema (gap — no per-endpoint doc exists)

- **`connector`** router — CRUD + sync for `Connector`/`EvidenceMapping`, adapter-pattern per connector `type` (AWS/AZURE/GCP/GITHUB/OKTA/JIRA/VERCEL).
- **`webhook`** router — HMAC-signed outgoing webhook config (TRD mentions "webhook HMAC signing" as a per-phase technical note).
- **`marketplace`** router — publish/discover/import (`MarketplaceItem`, `ImportedItem`).
- **`pentest`** router — request/status/results, including the CVSS calculator noted in TRD.
- **`aiAdvisor`** router — RAG chat endpoint over `OrganizationEmbedding`.
- **`sso`**/**`scim`** routers — SAML/OIDC config, SCIM provisioning (`User.scimExternalId`).
- **`mssp`** router — the single documented consumer of cross-tenant access is `src/server/services/mssp/aggregateQuery.service.ts`, gated by `MsspGrant`.
- **`endpoint`** router — agent enrollment/heartbeat/check-submission.
- **`apiKey`** router — third-party API key issuance/revocation, scoped (`ApiKey.scopes`).

Each of these should get a dedicated flow doc — see the gap list in [[User_Journeys]].

Related: [[Database_Design]], [[Authentication]], [[Authorization]].
