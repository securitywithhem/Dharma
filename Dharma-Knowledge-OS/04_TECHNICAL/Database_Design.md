---
title: Database Design
folder: 04_TECHNICAL
tags: [dharma, technical, database, prisma, pgvector, pivot]
source_docs: [Dharma_Pivot_Architecture_Plan.md, packages/db/schema.prisma, 5_BACKEND_SCHEMA.md]
last_updated: 2026-08-08
status: reviewed
---

# Database Design

PostgreSQL + `pgvector` extension, Prisma ORM. This note transcribes the **live schema** (`packages/db/schema.prisma`, 49 models as of 2026-08-04) and then layers the pivot's additive migration plan (`Dharma_Pivot_Architecture_Plan.md` §4) on top. **Migration discipline: additive only in the first pass.** Do not drop `Vulnerability`/`PenTest` until `Finding` has a proven writer path and a backfill script.

**pgvector dependency**: five columns use `Unsupported("vector(384)")` — `Control.embedding`, `Evidence.embedding`, `RegulationSnippet.embedding`, `Vulnerability.embedding`, `OrganizationEmbedding.embedding`. All 384-dimensional (Ollama `nomic-embed-text`). The pivot's `LLMProvider` abstraction (see [[System_Architecture]]) does not change this convention — Ollama stays the default embedding provider; raw SQL writes via `$1::vector` remain the pattern for any new embedding column, since Prisma has no native vector type.

## Foundation (pre-pivot, kept unchanged)

- **`Organization`** — tenant root; owns nearly every other model by `organizationId`.
- **`User`** / **`Account`** / **`Session`** / **`VerificationToken`** — NextAuth-compatible identity. `Role` enum: `ADMIN`, `COMPLIANCE_MANAGER`, `VIEWER`, `PUBLISHER`.
- **`Framework`** → **`Control`** (self-referential hierarchy via `parentId`/`path`/`depth`) — **now core**, the landing surface for auto-generated evidence, unchanged shape.
- **`Evidence`** — MinIO file pointer + `vector(384)` embedding + `embeddingStatus`. **Extend**: add a `source` field (`"manual" | "auto-connector" | "agent"`) so agent-produced evidence is distinguishable, never conflated with manual uploads.
- **`Policy`**, **`AuditLog`** (SHA-256 hash chain), **`RegulationSnippet`**, **`AuditorAccess`**, **`OrganizationInvite`** — unchanged.

## Pre-pivot Phase 2–9 models (kept, unaffected unless noted)

- **`ChainAnchor`**, **`Connector`**/**`EvidenceMapping`**, **`Webhook`**/**`WebhookDelivery`**, **`PolicyTemplate`**, **`AuditExport`** — unchanged. `Connector` is re-scoped conceptually (Phase E) as one evidence source among several, no schema change required.
- **`MarketplaceItem`**/**`MarketplaceReview`**/**`MarketplaceItemRevision`**/**`ImportedItem`** — kept for browse/import; no further schema investment for a commerce layer.
- **`PenTest`** / **`Vulnerability`** / **`Asset`** — **`Vulnerability`/`PenTest` are deprecated-pending-migration**, replaced by `Finding` (below). Do not add new fields to `Vulnerability`. `Asset` is **kept and reused**, but see the reconciliation note below before Phase B.
- **`ControlMapping`**, **`ReadinessScore`**, **`Recommendation`** — unchanged.
- **`AIAdvisorSession`**, **`OrganizationEmbedding`**, **`IngestedDocument`**, **`OrgGraphNode`**/**`OrgGraphEdge`**, **`AIUsageLog`** — kept; rewired onto the Knowledge Engine + `LLMProvider` in Phase E, not replaced.
- **`OrganizationSettings`**, **`CustomRole`**, **`OrganizationGroup`**/**`MsspGrant`** — kept. `CustomRole` gains new agent-tool permission keys in Phase B/F (additive to `PERMISSION_KEYS`, no schema change) — see [[Authorization]].
- **`Endpoint`**/**`EndpointCheck`** — kept as-is, no further investment (EDR-lite discarded from roadmap).
- **`Report`**/**`ReportSchedule`**, **`FrameworkVersion`**/**`RegulatoryAlert`**, **`ApiKey`** — kept, unaffected near-term; `Report` templates extend with Finding evidence sections in Phase D, `RegulatoryAlert` work parked to Phase G.
- **Billing** (`Plan`, `ProcessedWebhookEvent`, provider fields on `Organization`) — kept, entirely unaffected by the pivot. See [[Billing_And_Payments]].

## ⚠️ Reconciliation required before Phase B: `Asset`

The **live schema already has an `Asset` model**, scoped to the pentest module. The pivot plan's §4.1 `Asset` is broader (`AssetType`: `APPLICATION | REPOSITORY | API | DOMAIN | CLOUD_ACCOUNT | DATABASE | VENDOR`). **Do not create a second `Asset` table.** Before writing the Phase B migration:
1. Diff the existing `Asset` model's fields against the pivot's `AssetType` enum and `metadata Json` shape.
2. Extend the existing model's type enum and add `metadata` if missing, rather than duplicating.
3. Update every existing `Asset` foreign key (from `PenTest`/`Vulnerability`) to remain valid once `Finding.assetId` also points at the same table.

This is exactly the kind of deviation the coding standard requires documenting inline once resolved — see [[Coding_Standards]] item 6.

## New — pivot data model (Phase B onward, additive migrations)

```prisma
// Replaces the narrow Vulnerability/PenTest split with a unified discovery model
model Finding {
  id              String   @id @default(cuid())
  organizationId  String
  assetId         String?          // -> reconciled Asset model, see note above
  controlId       String?          // links straight into existing Control/Framework graph
  title           String
  description     String
  severity        Severity         // reuse existing enum
  confidence      Float            // 0.0–1.0, SEPARATE from severity
  status          FindingStatus    // POTENTIAL | UNDER_INVESTIGATION | CONFIRMED | REJECTED | ACCEPTED_RISK | RESOLVED | REOPENED
  cwe             String?
  source          FindingSource    // SAST | SCA | SECRETS | DAST | AGENT_EXPLOIT | MANUAL | CONNECTOR
  sourceLocation  Json?            // { file, line }
  targetEndpoint  Json?            // { method, path, parameter }
  evidenceIds     String[]         // -> Evidence
  reproduction    Json?            // ordered repro steps
  remediation     Json?            // { description, suggestedPatch }
  agentRunId      String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum FindingStatus {
  POTENTIAL
  UNDER_INVESTIGATION
  CONFIRMED
  REJECTED
  ACCEPTED_RISK
  RESOLVED
  REOPENED
}

enum FindingSource {
  SAST
  SCA
  SECRETS
  DAST
  AGENT_EXPLOIT
  MANUAL
  CONNECTOR
}

model AgentRun {
  id             String   @id @default(cuid())
  organizationId String
  scanId         String?
  agentType      String       // "recon" | "code" | "web" | "exploit" | "validator"
  toolCalls      Json         // structured log of every tool_use + result
  status         String
  startedAt      DateTime @default(now())
  completedAt    DateTime?
}

model Risk {
  id              String   @id @default(cuid())
  organizationId  String
  findingId       String?
  assetId         String?
  likelihood      RiskLevel
  impact          RiskLevel
  inherentRisk    RiskLevel
  residualRisk    RiskLevel?
  treatment       String?
  ownerId         String?
  status          String
  createdAt       DateTime @default(now())
}
```

**Backfill**: existing `Vulnerability` rows migrate to `Finding` with `source = MANUAL` or `AGENT_EXPLOIT` depending on origin, `confidence = 1.0` for anything already `RESOLVED`/`CONFIRMED`. `ControlMapping`/`Control` stay exactly as-is — `Finding.controlId` is the new writer into that graph, the graph's shape does not change.

**Tenant isolation**: every new model above carries `organizationId` and must be filtered the same way as every other model — see [[Authorization]]. This extends explicitly to `AgentRun.toolCalls`, vector retrieval for any agent embedding, and Knowledge Engine queries (Phase E) — no agent run, embedding, or knowledge-graph query may cross an `organizationId` boundary. Audit this specifically once Phase E RAG/knowledge-engine work starts.

Related: [[System_Architecture]], [[Security_Architecture]], [[Authentication]], [[Authorization]], [[Feature_Backlog]], [[Billing_And_Payments]].
