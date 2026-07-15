# Dharma — Complete Project Understanding Guide

**Generated:** 2026-07-15
**Scope:** Full codebase understanding (Phases 0–9)
**Mode:** Haiku-optimized detailed guide

---

## 📋 Table of Contents

1. [What is Dharma?](#what-is-dharma)
2. [Architecture Overview](#architecture-overview)
3. [Phase Breakdown](#phase-breakdown)
4. [Core Models & Database](#core-models--database)
5. [Router Structure](#router-structure)
6. [Worker/Queue System](#workerqueue-system)
7. [Authentication & Security](#authentication--security)
8. [Multi-Tenancy](#multi-tenancy)
9. [Data Flows](#data-flows)
10. [Key Gotchas](#key-gotchas)

---

## What is Dharma?

**Dharma** is a **self-hosted compliance management platform for Indian MSMEs** (Micro, Small, Medium Enterprises).

### Core Mission
Help small businesses:
- Understand compliance requirements (SOC2, ISO, GDPR, Indian regulations)
- Map controls to frameworks
- Collect & organize evidence
- Track audit readiness
- Generate compliance reports
- Scan for vulnerabilities
- Monitor regulatory changes

### Key Differentiators
- **Multi-tenant SaaS** — Supports multiple organizations with strict tenant isolation
- **White-label** — Orgs can customize branding
- **MSSP-capable** — Managed Service Providers can manage multiple client orgs
- **Enterprise SSO/SCIM** — SAML 2.0 + SCIM for large deployments
- **EDR-lite agent** — Endpoint monitoring for compliance checks
- **AI-powered** — LLM-based advisor, automatic control mapping, evidence tagging
- **Public API** — REST endpoints for integrations

---

## Architecture Overview

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14, React, TypeScript, TailwindCSS v4 |
| **Backend** | tRPC (typed RPC), Next.js API routes |
| **Database** | PostgreSQL 15 + pgvector (embeddings), Prisma ORM |
| **Cache/Queue** | Redis, BullMQ (job queues) |
| **Storage** | MinIO (S3-compatible object storage) |
| **Auth** | NextAuth.js, SAML 2.0, local passwords |
| **Payments** | Stripe (subscriptions) |
| **AI** | Claude API (embeddings, analysis) |

### Directory Structure

```
dharma/
├── packages/db/                   # Database layer
│   ├── schema.prisma              # Full schema (all phases)
│   └── migrations/                # Migration history
├── src/
│   ├── app/                       # Next.js app directory
│   │   ├── api/                   # Next.js API routes + v1 REST API
│   │   └── dashboard/             # User-facing UI pages
│   ├── server/
│   │   ├── routers/               # 30 tRPC routers
│   │   ├── queue/                 # BullMQ queues + workers
│   │   ├── lib/                   # Shared utilities
│   │   ├── connectors/            # Third-party integrations
│   │   └── services/              # Business logic
│   ├── components/                # React UI components
│   ├── lib/                       # Client utilities
│   └── styles/                    # Global CSS
├── tests/                         # Unit + integration tests (66 suites)
├── envs/                          # Environment configs
└── .ua/                           # Knowledge graph (Understand Anything)
```

---

## Phase Breakdown

### Phase 0: Foundation
**Status:** ✅ Complete

- Next.js + tRPC + Prisma + NextAuth setup
- PostgreSQL, Redis, MinIO infrastructure
- Base models: `User`, `Organization`, `Role`, `Account`, `Session`
- Audit middleware
- Tests & CI/CD

**Key files:**
- `src/server/trpc.ts` — tRPC context & middleware
- `jest.setup.ts` — Test configuration
- `envs/.env.development` — Dev environment

---

### Phase 1–2: Core Compliance MVP
**Status:** ✅ Complete

Single-org compliance management:

**Models:**
- `Framework` (SOC2, ISO27001, GDPR, etc.)
- `Control` (security control from framework)
- `Evidence` (proof of control compliance)
- `Policy` + `PolicyTemplate` (internal policies)
- `User` roles (ADMIN, COMPLIANCE_MANAGER, VIEWER, PUBLISHER)

**Routers:**
- `/framework` — Browse & import frameworks
- `/control` — View & manage controls
- `/evidence` — Upload & organize evidence
- `/policy` — Create & review policies

**Key files:**
- `src/server/routers/framework.ts`
- `src/server/routers/control.ts`
- `src/server/routers/evidence.ts`

---

### Phase 3a: Multi-Tenant Foundation
**Status:** ✅ Complete

Cross-org tenant isolation:

**Schema changes:**
- All models now have `organizationId` foreign key
- Row-level security (RLS) via Prisma client extensions
- `OrganizationInvite` — Invite users to org

**Key utilities:**
- `src/server/lib/prisma-extension.ts` — RLS enforcement
- `orgProcedure` — tRPC middleware that checks org membership

**Data guarantee:** Queries automatically filtered by org. A user from Org A cannot read Org B's data (enforced at the database layer).

---

### Phase 3b: Billing & Subscription
**Status:** ✅ Complete

Stripe integration + plan limits:

**Models:**
- `Plan` (Free, Pro, Enterprise) with JSON `limits` (max users, max connectors, etc.)
- `Organization.planId` → `Plan` (subscription)
- `SubscriptionStatus` enum (active, canceled, etc.)

**Routers:**
- `/billing` — Manage subscription, Stripe checkout

**Key files:**
- `src/server/routers/billing.ts`
- Entitlement middleware checks `org.plan.limits.maxUsers` before user invite

---

### Phase 3c: Marketplace
**Status:** ✅ Complete

Pre-built compliance templates:

**Models:**
- `MarketplaceItem` (SOC2 template, GDPR controls, etc.)
- `ImportedItem` (org's imported template)
- Framework/control/evidence templates copied on import

**Routers:**
- `/marketplace` — Browse public templates
- `/import` — Import template into org

---

### Phase 4: Automation & Cloud Connectors
**Status:** ✅ Complete

Connect to AWS, GitHub, Jira, Okta, etc.:

**Models:**
- `Connector` (AWS account, GitHub org, etc.)
- `EvidenceMapping` (which connectors feed which controls)
- Webhook for events

**Queues:**
- `connectorSyncQueue` — Fetch latest data from connector
- `connectorEvidenceWorker` — Map connector data to evidence
- `webhookQueue` → `webhookWorker` — Dispatch webhook events

**Connectors:**
- AWS CloudTrail (extract security logs)
- GitHub (check branch protections)
- Jira (ticket status)
- Okta (user provisioning)
- Generic webhook listener

**Key files:**
- `src/server/routers/connector.ts`
- `src/server/connectors/` — Provider-specific adapters
- `src/server/queue/workers/connectorEvidenceWorker.ts`

---

### Phase 5: Pentest & Vulnerability Scanning
**Status:** ✅ Complete

Security scanning:

**Models:**
- `PenTest` (pentest run request)
- `Vulnerability` (finding with CVSS score)

**Queues:**
- `pentestScanQueue` → `pentestScanWorker` — Run nuclei scanner (sandboxed)

**Key files:**
- `src/server/routers/pentest.ts`
- `src/server/queue/workers/pentestScanWorker.ts`
- `src/server/lib/cvss.ts` — CVSS scoring

---

### Phase 6: Advanced Frameworks & Readiness
**Status:** ✅ Complete

Framework relationships & scoring:

**Models:**
- `ControlMapping` (maps Control A to Control B across frameworks)
- `ReadinessScore` (evidence coverage %)

**Concepts:**
- Cross-walking (Control A in SOC2 ≈ Control B in ISO)
- Readiness: % of controls with evidence
- Hierarchy: framework → domain → control

**Routers:**
- `/controlMapping` — Manage cross-framework links
- `/readiness` — Calculate & view readiness scores

**Key files:**
- `src/server/routers/controlMapping.ts`
- `src/server/routers/readiness.ts`

---

### Phase 7: AI Advisor
**Status:** ✅ Complete

RAG chat about your compliance:

**Models:**
- `AIAdvisorSession` (chat conversation)
- `OrganizationEmbedding` (pgvector embeddings of your controls/evidence)
- `AIUsageLog` (token tracking)

**Queues:**
- `aiIngestionQueue` → `aiIngestionWorker` — Embed org data into pgvector

**Concepts:**
- LLM embeds your control descriptions + evidence into vectors
- User asks question → retrieved similar controls via cosine similarity
- LLM generates response using retrieved context (RAG)

**Routers:**
- `/aiAdvisor` — Chat endpoint
- `/aiIngestion` — Trigger embedding pipeline

**Key files:**
- `src/server/routers/aiAdvisor.ts`
- `src/server/queue/workers/aiIngestionWorker.ts`

---

### Phase 8: Enterprise & White-Label
**Status:** ✅ Complete

SSO, SCIM, RBAC, audit logging, MSSP:

**Models:**
- `OrganizationSettings` (SSO config, white-label theme)
- `CustomRole` (fine-grained permissions JSON)
- `AuditLog` (append-only hash-chained log of all actions)
- `AuditExport` (bulk export to SIEM)
- `OrganizationGroup` (MSSP grant for cross-org access)

**Auth:**
- SAML 2.0 metadata upload → SSO login enforced
- SCIM token endpoint → sync users from IdP

**RBAC:**
- Built-in roles: ADMIN, COMPLIANCE_MANAGER, VIEWER, PUBLISHER
- Custom roles with per-action permissions (JSON)
- `requirePermission()` middleware

**Audit:**
- Every mutation writes to append-only log (userId, action, entity, changes, previousHash)
- Hash chain prevents tampering
- BullMQ async writer (AUDIT_WRITER_MODE=sync in tests)

**MSSP:**
- `MsspGrant` model — Manager org can see & manage client orgs
- RLS bypass for MSSP role only

**Routers:**
- `/sso` — SAML metadata endpoints
- `/roles` — Role management
- `/audit` — Audit log retrieval
- `/mssp` — Cross-org access

**Key files:**
- `src/server/routers/sso.ts`
- `src/server/lib/rbac.ts`
- `src/server/audit-log.ts`
- `src/server/queue/workers/auditEventWorker.ts`

---

### Phase 9: EDR-lite Agent, Advanced Reporting, Regulatory Monitoring & Public API
**Status:** ✅ Complete (just committed 2026-07-15)

#### Part 1: Endpoint Agent (EDR-lite)

**Models:**
- `Endpoint` (device enrolled in compliance checking)
- `EndpointCheck` (result of a compliance check run on endpoint)

**Concept:**
- Register endpoints (servers, laptops, etc.)
- Agent polls `/api/agent/heartbeat` for check tasks
- Agent runs local checks (firewall enabled?, encryption enabled?, etc.)
- Agent POSTs results → `EndpointCheck` created
- `EndpointCheckPostprocessWorker` maps results to controls

**Routers:**
- `/endpoint` → enroll, list, revoke, getChecks

**Key files:**
- `src/app/api/agent/heartbeat/route.ts` — Agent API
- `src/server/lib/endpointAuth.ts` — Token-based agent auth
- `src/server/queue/workers/endpointCheckPostprocessWorker.ts`

#### Part 2: Advanced Reporting

**Models:**
- `Report` (SOC2 audit report, GDPR compliance report, etc.)
- `ReportSchedule` (recurring report generation)

**Concept:**
- Create custom reports (select controls, date range, format)
- Export as PDF (with branding, signatures)
- Schedule weekly/monthly generation
- Email delivery

**Queues:**
- `reportQueue` → `reportWorker` — Generate report
- `reportScheduleQueue` → `reportScheduleDispatchWorker` — Trigger scheduled reports

**Routers:**
- `/report` → create, get, list, schedule, delete, exportReport, exportAuditorPackage

**Key files:**
- `src/server/routers/report.ts`
- `src/lib/pdf/BoardSummaryDocument.tsx`
- `src/server/queue/workers/reportWorker.ts`

#### Part 3: Regulatory Monitoring & Public API

**Regulatory Monitoring:**

**Models:**
- `RegulatoryAlert` (new regulation published, deadline, etc.)
- `FrameworkVersion` (version history of regulations)

**Concept:**
- Poller checks for new regulations (auto)
- Diff engine compares versions → identifies changes
- Alerts org to new requirements
- Org can acknowledge/dismiss

**Routers:**
- `/regulatory` → listAlerts, acknowledge, dismiss, publishVersion, unreadCount

**Key files:**
- `src/server/lib/regulatory/versionPoller.ts`
- `src/server/lib/regulatory/diffEngine.ts`
- `src/server/queue/workers/regulatoryFanoutWorker.ts`

**Public API (REST):**

**Concept:**
- Expose Dharma data to external integrations (ITSM, SIEM, etc.)
- API keys with scopes (read, write, delete)
- Authentication via header `Authorization: Bearer <api_key>`
- OpenAPI spec auto-generated

**Endpoints:**
- `GET /api/v1/controls` — List controls
- `GET /api/v1/evidence` — List evidence
- `GET /api/v1/frameworks` — List frameworks
- `GET /api/v1/reports` — List reports
- `GET /api/v1/vulnerabilities` — List vulnerabilities
- `GET /api/v1/openapi.json` — OpenAPI spec

**Routers:**
- `/apiKey` → create, list, revoke, scopes

**Key files:**
- `src/app/api/v1/` — REST endpoints
- `src/server/lib/apiKey.ts` — Key hashing & validation
- `src/server/lib/graphify/complianceGraphBuilder.ts` — Graph building

---

## Core Models & Database

### Complete Schema

**User & Organization:**
- `User` (email, password, org, role, customRole)
- `Organization` (name, planId, settings)
- `OrganizationSettings` (SSO config, white-label JSON)
- `OrganizationInvite` (pending invite)
- `OrganizationGroup` (MSSP groups)
- `OrganizationEmbedding` (pgvector for RAG)

**Compliance:**
- `Framework` (SOC2, ISO, GDPR, etc.)
- `FrameworkVersion` (version history for regulatory monitoring)
- `Control` (security control)
- `ControlMapping` (cross-framework links)
- `Evidence` (proof/artifact)
- `EvidenceMapping` (connector → evidence mapping)
- `Policy` (org policy)
- `PolicyTemplate` (shared templates)

**Integration:**
- `Connector` (AWS, GitHub, Okta, etc.)
- `Webhook` (event webhook)
- `WebhookDelivery` (webhook event delivery log)

**Security:**
- `PenTest` (pentest request)
- `Vulnerability` (CVSS finding)
- `ApiKey` (REST API authentication)

**Readiness:**
- `ReadinessScore` (evidence coverage %)
- `Recommendation` (suggested actions)

**AI:**
- `AIAdvisorSession` (chat session)
- `AIUsageLog` (token usage log)
- `IngestedDocument` (chunks for RAG)

**Audit:**
- `AuditLog` (append-only hash-chained log)
- `AuditExport` (bulk export)

**Reporting:**
- `Report` (generated compliance report)
- `ReportSchedule` (recurring report)

**Regulatory:**
- `RegulatoryAlert` (new regulation)
- `RegulationSnippet` (regulation text chunk)

**Endpoint Agent:**
- `Endpoint` (enrolled device)
- `EndpointCheck` (check result)

**Access Control:**
- `Role` (built-in roles)
- `CustomRole` (fine-grained roles)
- `AuditorAccess` (auditor access to org)

**Enums & Status:**
- `ControlStatus`, `EvidenceType`, `FrameworkVersion`, `ItemType`
- `PenTestStatus`, `VulnStatus`, `ReportStatus`, `AlertStatus`, `SubscriptionStatus`
- `ConnectorStatus`, `EndpointStatus`, `EmbeddingStatus`, `IngestionStatus`

---

## Router Structure

### 30 tRPC Routers

| Router | Purpose |
|--------|---------|
| **audit** | Audit log retrieval + SIEM export |
| **policy** | Policy creation & review |
| **dashboard** | Dashboard metrics & stats |
| **report** | Report generation, scheduling |
| **evidence** | Evidence upload & retrieval |
| **control** | Control management |
| **framework** | Framework browsing |
| **health** | Health check endpoint |
| **settings** | Org settings (name, plan, etc.) |
| **onboarding** | Initial org setup wizard |
| **connector** | Third-party integrations |
| **evidenceMapping** | Auto-map connector → evidence |
| **webhook** | Webhook management |
| **billing** | Stripe subscription |
| **entitlement** | Plan limits enforcement |
| **marketplace** | Browse templates |
| **import** | Import templates into org |
| **pentest** | Pentest request & results |
| **vulnerability** | Vulnerability list & management |
| **controlMapping** | Cross-framework control links |
| **readiness** | Readiness scores |
| **aiIngestion** | Trigger AI embedding |
| **aiAdvisor** | RAG chat |
| **sso** | SAML endpoints |
| **roles** | Role management |
| **whiteLabel** | White-label settings |
| **mssp** | MSSP cross-org access |
| **endpoint** | Endpoint agent enrollment |
| **regulatory** | Regulatory monitoring |
| **apiKey** | REST API key management |

**Router registration:**
All 30 registered in `src/server/routers/index.ts` as `appRouter`.

---

## Worker/Queue System

### BullMQ Queues

| Queue | Worker | Purpose |
|-------|--------|---------|
| `classification` | classificationWorker | Auto-categorize evidence |
| `policy-review` | policyWorker | Auto-review policy drafts |
| `anchor-chain` | anchorWorker | Build anchor-chain audit proof |
| `connector-sync` | connectorWorker | Fetch from 3rd-party APIs |
| `connector-evidence` | connectorEvidenceWorker | Map connector data → evidence |
| `webhook-dispatch` | webhookWorker | Send webhook events |
| `control-embedding` | controlEmbeddingWorker | Embed control descriptions |
| `readiness-score` | readinessScoreWorker | Calculate readiness % |
| `ai-ingestion` | aiIngestionWorker | Ingest org data for RAG |
| `evidence-auto-tag` | evidenceAutoTagWorker | Auto-tag evidence by type |
| `audit-event` | auditEventWorker | Write audit logs |
| `siem-export` | siemExportWorker | Export audit to SIEM |
| `endpoint-check-postprocess` | endpointCheckPostprocessWorker | Map check results → controls |
| `endpoint-stale-sweep` | endpointStaleSweepWorker | Mark stale endpoints offline |
| `report-generation` | reportWorker | Generate compliance reports |
| `report-schedule-dispatch` | reportScheduleDispatchWorker | Trigger scheduled reports |
| `regulatory-fanout` | regulatoryFanoutWorker | Alert orgs of new regulations |

**Entry point:** `src/workers/index.ts`

All workers start on `pnpm workers:start` (not defined in this package.json, would be in a separate CLI script).

---

## Authentication & Security

### Session Management
- NextAuth.js + `next-auth` for login/session
- JWT tokens in `next-auth.config.ts`
- Session persisted in `Session` model

### Org Membership Enforcement
- `orgProcedure` middleware checks user's org membership
- All queries auto-filtered by org via Prisma RLS extension
- **Guarantee:** Logged-in user from Org A cannot access Org B's data

### Role-Based Access Control (RBAC)
- Built-in roles: ADMIN, COMPLIANCE_MANAGER, VIEWER, PUBLISHER
- Custom roles via `CustomRole.permissions` (JSON object)
- `requirePermission()` middleware checks permission on each procedure
- **Example:** `pentest.create` requires `permission: "pentest:create"`

### API Key Authentication (Phase 9)
- Token-based auth for REST API + agent endpoint
- Keys stored hashed (Argon2)
- Scopes: `read`, `write`, `delete`
- **Usage:** `Authorization: Bearer <api_key>` header

### Audit Log Security
- Append-only hash-chained log (`AuditLog`)
- Previous hash stored → prevents tampering
- Async BullMQ writer (high throughput)
- SIEM export capability

### SAML SSO (Phase 8)
- Org uploads SAML metadata
- NextAuth.js SAML provider
- SSO login enforced for that org (password login blocked)
- User auto-created on first SSO login

### Secrets at Rest
- Per-domain AES-256-GCM encryption keys
- `CONNECTOR_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY`, `SSO_ENCRYPTION_KEY`, `SIEM_ENCRYPTION_KEY` (64-hex each)
- Connector credentials stored encrypted

---

## Multi-Tenancy

### Isolation Strategy

**Row-Level Security (RLS):**
- All models have `organizationId`
- Prisma extension adds automatic WHERE clause: `WHERE organizationId = $1`
- **Enforcement point:** Database query level (not application level)

**Code pattern:**
```typescript
// Every router procedure wraps with orgProcedure middleware
const myRouter = createTRPCRouter({
  getControls: orgProcedure
    .query(async ({ ctx, input }) => {
      // ctx.org is the authenticated user's org
      // Database query auto-filtered: WHERE organizationId = ctx.org.id
      return db.control.findMany(); // Safe!
    }),
});
```

### MSSP (Managed Service Provider)
- MSSP org can manage multiple client orgs
- `OrganizationGroup` model: `{ msspOrgId, clientOrgId }`
- `MsspGrant` RLS bypass only for MSSP admin role
- Client org unaware of MSSP access (transparent)

### Data Isolation Guarantees
- ✅ User A's org cannot read User B's org (RLS)
- ✅ User A's embeddings never surface in User B's RAG (semantic search is org-scoped)
- ✅ User A's audit log is independent (separate rows, org-filtered)
- ✅ User A's webhook events are independent

---

## Data Flows

### 1. Evidence Collection Flow
```
User uploads evidence file
  ↓
POST /dashboard/evidence → tRPC evidence.upload
  ↓
File saved to MinIO
  ↓
Evidence row created
  ↓
evidenceAutoTagWorker tags by type (auto)
  ↓
UI updates (invalidate evidence query)
```

### 2. Connector Sync Flow
```
User adds AWS connector + credentials
  ↓
Connector.status = DISCONNECTED
  ↓
User clicks "Sync now"
  ↓
tRPC connector.sync enqueues connectorSyncJob
  ↓
connectorWorker queries AWS CloudTrail API
  ↓
Results → Evidence rows created
  ↓
evidenceMappingWorker maps to controls
  ↓
Control.status updates (how many evidence items?)
```

### 3. Readiness Calculation Flow
```
Evidence added/removed
  ↓
Control status recalculated (how many controls have evidence?)
  ↓
readinessScoreWorker enqueued (scheduled daily sweep)
  ↓
Calculates: totalControls, evidenceControls, readiness%
  ↓
ReadinessScore row updated
  ↓
Dashboard readiness card updates
```

### 4. AI Advisor (RAG) Flow
```
User types question in chat
  ↓
tRPC aiAdvisor.chat enqueues aiIngestionJob (if first time)
  ↓
aiIngestionWorker embeds all org controls + evidence into pgvector
  ↓
User question embedded via Claude API
  ↓
Cosine similarity search in pgvector (topK results)
  ↓
Claude generates response using retrieved context
  ↓
Chat bubble appears
```

### 5. Report Generation Flow
```
User creates report (select controls, format, date range)
  ↓
Report row created (status: PENDING)
  ↓
tRPC report.create enqueues reportJob
  ↓
reportWorker collects data (controls, evidence, vulnerabilities)
  ↓
PDF renderer (React + @react-pdf) generates document
  ↓
PDF stored to MinIO
  ↓
Report.status = COMPLETED, presigned URL generated
  ↓
UI shows "Download" link
```

### 6. Audit Log Flow
```
User creates policy / adds evidence / updates control
  ↓
tRPC procedure calls emitAuditEvent()
  ↓
Enqueues auditEventJob (async BullMQ writer)
  ↓
auditEventWorker writes AuditLog row:
   { userId, action, entity, entityId, changes, timestamp, previousHash, newHash }
  ↓
Hash chain verified (newHash = SHA256(previousEntry))
  ↓
SIEM export reads from AuditLog periodically
```

### 7. Regulatory Monitoring Flow
```
Scheduled job runs (daily cron)
  ↓
regulatoryVersionPoller checks official regulation sources
  ↓
New version detected → FrameworkVersion row created
  ↓
diffEngine compares versions (old vs new requirements)
  ↓
Changes identified → RegulatoryAlert rows created per org
  ↓
regulatoryFanoutWorker broadcasts alerts
  ↓
Org sees "3 new regulatory requirements"
```

### 8. Endpoint Agent Flow
```
Server/laptop installs Dharma agent
  ↓
Agent authenticates with token (endpointAuth)
  ↓
POST /api/agent/heartbeat?token=<token>
  ↓
API checks token validity, returns check tasks:
   { checks: [ { id: 1, type: 'firewall-enabled' }, ... ] }
  ↓
Agent runs local checks
  ↓
POST /api/agent/heartbeat with results:
   { checkResults: [ { id: 1, passed: true }, ... ] }
  ↓
EndpointCheck rows created
  ↓
endpointCheckPostprocessWorker maps results to controls
  ↓
Control status updated (endpoint A passed check X, etc.)
```

---

## Key Gotchas

### 1. Jest Mock Hoisting
**Problem:** Importing `jest` from `@jest/globals` breaks mock hoisting.
**Solution:** Use global `jest` object only (SWC transform requirement).

### 2. Redis Open Handles
**Problem:** After jest suite runs, Redis connections hang open → "did not exit" warning.
**Solution:** Add teardown to close connections, or run with `--forceExit`.

### 3. Prisma $transaction Requirement
**Problem:** All mutations must wrap in `prisma.$transaction()` for consistency.
**Solution:** Phase 8's audit log change made this mandatory — old test mocks break if they don't stub `$transaction`.

### 4. Tree-Sitter WASM
**Problem:** Native `tree-sitter` bindings fail on darwin/arm64 + Node 24.
**Solution:** Use `web-tree-sitter` (WASM) instead.

### 5. Data Directory Auto-Resolution
**Problem:** Different projects use `.ua/` (new) vs `.understand-anything/` (legacy).
**Solution:** Code auto-detects; if `.understand-anything/` exists, uses that; otherwise creates `.ua/`.

### 6. Dashboard Imports
**Problem:** Dashboard importing from core's main entry pulls Node.js modules into browser build.
**Solution:** Import from subpath exports only: `./search`, `./types`, `./schema`.

### 7. Pre-existing Test Failures
**Status:** 3 failures in `tests/onboarding-router.test.ts` (Prisma mock missing `$transaction`)
**Impact:** Not a regression; pre-existing on commit `a5913e1`
**Fix:** Extend mock to implement `$transaction`

### 8. Tenant Isolation Coverage Gap
**Problem:** `phase8-tenant-isolation.test.ts` only covers Phase 8 tables (SSO, SCIM, roles, audit, white-label), not Phase 9 tables.
**Solution:** Individual routers enforce org scoping via `orgProcedure`, but no dedicated cross-phase negative regression test.

### 9. Language-Specific Parsing
**Problem:** Tree-sitter needs language-specific grammars.
**Solution:** Separate tree-sitter packages for each language (Dart, Swift, etc.) as separate npm packages with WASM bindings.

### 10. Plugin Version Sync
**Problem:** Six version fields across different plugin configs must stay in sync.
**Solution:** Before release, bump version in:
   - `understand-anything-plugin/package.json`
   - `understand-anything-plugin/.claude-plugin/plugin.json`
   - `understand-anything-plugin/packages/viewer/package.json`
   - `.claude-plugin/plugin.json`
   - `.cursor-plugin/plugin.json`
   - `.copilot-plugin/plugin.json`

---

## How to Explore Further

### Use These Commands

```bash
# Understand a specific router
/understand-explain src/server/routers/report.ts

# Ask about a flow
/understand-chat How does the report generation work end-to-end?

# See impact of changes
/understand-diff

# Generate onboarding
/understand-onboard
```

### Key Files to Read (In Order)

1. **Architecture:**
   - `src/server/trpc.ts` — Context & middleware
   - `src/server/routers/index.ts` — Router registration

2. **Database:**
   - `packages/db/schema.prisma` — Full schema
   - `packages/db/migrations/` — Migration history

3. **Auth & Multi-tenancy:**
   - `src/server/lib/prisma-extension.ts` — RLS enforcement
   - `src/server/lib/rbac.ts` — Role checking

4. **Audit:**
   - `src/server/audit-log.ts` — Hash-chained log
   - `src/server/queue/workers/auditEventWorker.ts` — Async writer

5. **Phase 9 (Latest):**
   - `src/server/routers/endpoint.ts` — Agent enrollment
   - `src/server/routers/report.ts` — Report generation
   - `src/server/routers/regulatory.ts` — Regulatory monitoring
   - `src/app/api/v1/` — REST API endpoints

---

**End of guide. You now have a complete mental map of Dharma. Use `/understand-chat` or `/understand-explain` for deeper dives into specific areas.**
