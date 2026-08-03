---
title: API Design
folder: 04_TECHNICAL
tags: [dharma, technical, api, trpc]
source_docs: [5_BACKEND_SCHEMA.md, 2_TRD.md, src/server/routers/index.ts]
last_updated: 2026-08-04
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

## Built but undocumented (gap — no per-endpoint doc exists)

`src/server/routers/index.ts` registers **31 routers**. Beyond the five documented above:

- **`connector`** — CRUD + sync for `Connector`/`EvidenceMapping`, dispatched through the adapter registry (see [[Coding_Standards]] for which connector types are actually live).
- **`evidenceMapping`** — the mapping board between connector output and controls.
- **`webhook`** — HMAC-signed outgoing webhook config (TRD mentions "webhook HMAC signing" as a per-phase technical note).
- **`billing`** / **`entitlement`** — subscription lifecycle and plan-limit reads. Entitlement is also enforced as middleware (`src/server/middleware/entitlement.ts`), consumed by `evidence`, `framework`, `onboarding`, `pentest` and `import`. See [[Billing_And_Payments]].
- **`marketplace`** / **`import`** — publish/discover/import (`MarketplaceItem`, `ImportedItem`).
- **`pentest`** / **`vulnerability`** — request/status/results, including the CVSS calculator noted in TRD.
- **`controlMapping`** / **`readiness`** — cross-walk suggestions and readiness scoring.
- **`aiAdvisor`** / **`aiIngestion`** — RAG chat and document ingestion over `OrganizationEmbedding`.
- **`sso`** — SAML/OIDC config, connection test, SSO enforcement, and SCIM token issue/revoke. There is **no separate `scim` tRPC router**: SCIM is served as REST at `src/app/api/scim/v2/[orgId]/{Users,Groups,ServiceProviderConfig}`, as the SCIM 2.0 spec requires, with SSO login/callback/metadata likewise at `src/app/api/sso/{saml,oidc}/[orgId]/*`.
- **`roles`** / **`whiteLabel`** — Phase 8 custom RBAC and tenant theming.
- **`mssp`** — the single consumer of cross-tenant access is `src/server/services/mssp/aggregateQuery.service.ts`, gated by `MsspGrant`.
- **`endpoint`** — agent enrollment/heartbeat/check-submission.
- **`regulatory`** / **`report`** — framework-version alerts and async report generation.
- **`apiKey`** — third-party API key issuance/revocation, scoped (`ApiKey.scopes`). The public surface it authenticates lives at `src/app/api/v1/`.
- **`dashboard`**, **`health`**, **`settings`**, **`organization`**, **`user`**, **`onboarding`** — app-shell and tenant-admin surfaces.

Each of these should get a dedicated flow doc — see the gap list in [[User_Journeys]].

Related: [[Database_Design]], [[Authentication]], [[Authorization]], [[Billing_And_Payments]].
