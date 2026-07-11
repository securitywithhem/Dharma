*




---

##  DOCUMENT 6: future-scope-ImplementationPlan.md

```markdown
# Dharma Future Scope – Implementation Plan

## Overall Timeline (relative to Phase 3a completion)
- **Phase 3b (Billing)**: 2 weeks
- **Phase 3c (Marketplace)**: 3 weeks
- **Phase 4 (Automation & Connectors)**: 4 weeks
- **Phase 5 (Pentest & Vulns)**: 3 weeks
- **Phase 6 (Advanced Frameworks)**: 2 weeks
- **Phase 7 (AI Advisor)**: 4 weeks
- **Phase 8 (Enterprise & White-Label)**: 3 weeks
- **Integration, hardening, testing overlap**: +3 weeks

Total ~24 weeks (6 months) from a solid Phase 3a base.

## Detailed Task Breakdown

### Phase 3b: Billing & Subscription
1. Set up Stripe products/prices in dashboard.
2. Add `Plan` model and seed DB with free/pro/enterprise.
3. Create checkout session API endpoint, webhook handler.
4. Implement entitlement middleware (check plan limits on user invite, framework creation, file uploads).
5. Build billing page UI (plan selection, current usage, invoice history).

### Phase 3c: Marketplace
1. Create `MarketplaceItem` CRUD for global (admin) catalog.
2. Import flow: copy framework/controls/templates to org, track via `ImportedItem`.
3. Publishing flow (community): submit item, admin review (future) or auto-publish.
4. Rating and review system.
5. Marketplace UI screens (browse, detail, publisher dashboard).

### Phase 4: Automation & Cloud Connectors
1. Design connector interface and implement AWS connector using SDK.
2. Secure credential storage (encrypted JSON).
3. Connection testing and status display.
4. Evidence mapping UI + backend.
5. BullMQ scheduler for periodic evidence collection.
6. Implement webhook dispatcher with manual trigger and secret signing.

### Phase 5: Penetration Testing & Vulns
1. Containerize nuclei or similar scanner with safe options.
2. Build scan queue: create `PenTest`, push job, capture output.
3. Parse results into `Vulnerability` records, map to control if configured.
4. Vulnerability management UI (list, filter, status transitions, manual add).
5. CVSS calculator and severity badges.

### Phase 6: Advanced Frameworks
1. Allow unlimited nesting in control hierarchy (recursive component or path field).
2. Cross-walk mapping UI: side-by-side picker, mapping table.
3. Readiness score algorithm (weighted by evidence and mapping).
4. Score dashboard and recommendation engine (rule-based, later AI).

### Phase 7: AI Advisor
1. Set up pgvector, create embeddings for existing controls and evidence docs.
2. Build ingestion pipeline: on document upload, chunk and embed.
3. RAG chat endpoint: retrieve relevant chunks, compose prompt, stream response.
4. Guardrails: system prompt to restrict scope, output validation.
5. Chat UI with streaming and citation chips.
6. Rate limiting and token cost tracking per org.

### Phase 8: Enterprise & White-Label
1. SAML/OIDC implementation, SCIM server.
2. Audit event logging and viewer.
3. RBAC with custom roles (extend `MemberRole` to permissions JSON).
4. White-label settings and server-side theming.
5. MSSP dashboard: aggregate queries across org group, role-based access.

### Integration & Testing
- Full regression on tenant isolation after each phase.
- Load testing for AI and scan endpoints.
- Security review for connector credential handling.

## Dependencies
- AI advisor depends on Phase 6 (advanced frameworks) for rich context.
- Marketplace can run parallel to billing.
- Enterprise SSO independent but benefits from billing plan enforcement.

## Milestones
| Milestone | Deliverable | ETA from start |
|-----------|-------------|----------------|
| M1 | Billing + Marketplace live | Week 5 |
| M2 | First cloud connector (AWS) working | Week 9 |
| M3 | Automated pentest MVP | Week 12 |
| M4 | AI advisor beta | Week 16 |
| M5 | Enterprise ready (SSO, audit) | Week 19 |
| M6 | Full platform release | Week 24 |

## Phase 5 Part 1 — Implementation Notes

Covers Phase 5 tasks 1-2 ("Containerize nuclei", "Build scan queue") from the
table above — the data model and sandboxed scan engine. Task 3 (parse results
into `Vulnerability` records, map to controls), task 4 (vuln management UI),
and task 5 (CVSS calculator) are Phase 5 Parts 2/3.

**Models added** (`packages/db/schema.prisma`, migration
`20260711143208_phase5_pentest_vulnerability_models`):
- `PenTest` — `id, organizationId, target, type, status, result, startedAt,
  completedAt, createdAt` per BackendSchema.md, plus three fields not in the
  original spec: `containerLogUrl` (MinIO path to the raw scanner log, kept
  separate from `result` for audit/debug access to the untruncated output),
  `scheduleCron` (recurring-scan cron expression — PRD's "scheduled cadence"
  requirement wasn't represented in the original schema block), and
  `requestedById` (FK to `User`, needed for audit logging and RBAC). Also
  added a `CANCELLED` status to `PenTestStatus` (spec only had
  QUEUED/RUNNING/COMPLETED/FAILED) so `pentest.cancel` has a status to set.
- `Vulnerability` — copied from BackendSchema.md as specified; unused by any
  write path yet (Part 2 owns turning scan findings into these rows). Present
  now only so `PenTest.vulnerabilities` can be included in `getById`.
- Composite `@@index([organizationId, createdAt])` on both, per TRD's
  "Performance & Scalability" section.

**Sandboxed scanner** (`docker/pentest-scanner/Dockerfile`,
`src/server/pentest/scanner.ts`):
- Wraps `projectdiscovery/nuclei`, pinned to a digest resolved at build time
  (not `:latest`), running as a non-root user, `--read-only` root filesystem,
  `--tmpfs /tmp`, `--security-opt no-new-privileges`, and its own per-run
  isolated Docker network (created before each scan, torn down after) rather
  than the shared `dharma-network`.
- `runNucleiScan()` rejects targets resolving to private/internal address
  space (RFC1918, loopback, link-local — including via DNS lookup, to guard
  against DNS-rebinding a public-looking domain to an internal IP). It does
  **not** yet verify actual ownership of the target — see the
  `targetVerification` TODO in scanner.ts. Until that DNS-TXT-challenge
  gate exists, `pentest.create` requires the requesting admin to pass
  `ownershipConfirmed: true`, an explicit attestation captured in the tRPC
  input, as the interim control.
- Target is always passed as a discrete `child_process.spawn` argv element,
  never interpolated into a shell string.

**Deviation from the original task brief — worker isolation**: rather than
running `docker run` from inside the existing shared `worker` container
(which handles connector/AI/webhook credentials), Phase 5 Part 1 adds a
**separate** `pentest-worker` container/image
(`docker/pentest-worker/Dockerfile`, `src/workers/pentestScanRunner.ts`). It
is the only service with the host Docker socket mounted
(`docker-compose.yml`), so a compromised scan target can't pivot to the
credentials or queues the regular worker touches. This is a real security
trade-off the original task brief didn't resolve (mounting the Docker socket
is host-root-equivalent access); isolating it to a single-purpose container
was chosen as the smaller blast radius over granting that access to the
general-purpose worker.

**Scheduling — reused the existing repeatable-job pattern instead of a new
hourly scheduler.** The task brief suggested a separate
`pentest-scheduler.worker.ts` polling hourly for due `scheduleCron` values.
Instead, `pentest.create` registers a BullMQ **repeatable job** directly
(`addOrUpdatePentestSchedule` in `pentestScanQueue.ts`), mirroring the
pattern Phase 4's `connectorQueue.ts` already uses for
`EvidenceMapping.schedule`. Each repeatable fire carries no concrete
`PenTest` id yet — `pentestScanWorker.ts`'s processor creates a fresh
`PenTest` row per fire (preserving full run history) before scanning. This
avoided adding a `cron-parser` dependency the repo didn't already have, and
kept scheduling logic in one place instead of two workers.

**Queue/worker**: `pentest-scan` (BullMQ `Queue` in
`src/server/queue/pentestScanQueue.ts`, `Worker` in
`src/server/queue/workers/pentestScanWorker.ts`). Concurrency 2
(`PENTEST_WORKER_CONCURRENCY`), 1 retry with a fixed 30s backoff. Drives
`QUEUED -> RUNNING -> COMPLETED|FAILED|CANCELLED`.

**tRPC router** (`src/server/routers/pentest.ts`, registered in
`src/server/routers/index.ts` as `pentest`): `create`, `list` (cursor-paginated),
`getById` (includes `vulnerabilities`), `getStatus` (lightweight polling for
the progress UI in Appflow.md §4), `cancel`. All org-scoped via
`orgProcedure`/`managerProcedure`, all mutations audit-logged via the
existing `AuditLog`/`createAuditLog` mechanism (action strings
`PENTEST_CREATED`, `PENTEST_COMPLETED`, `PENTEST_FAILED`,
`PENTEST_CANCELLED` — matching the SCREAMING_SNAKE convention already used
by `connector.ts`, not the `pentest.created`-style dotted actions the task
brief assumed; the repo has no `AuditEvent` model, only `AuditLog`).

Added a `pentests` `ResourceType` to `EntitlementService`
(`src/server/services/entitlement.ts`), free-tier cap 20 total requests —
an MVP placeholder cap invented for this Part, not specified anywhere in
PRD/TRD.

**Deviations from the literal file paths in the original task brief** (the
actual repo layout differs from what was assumed): schema is
`packages/db/schema.prisma`, not `prisma/schema.prisma`; routers live in
`src/server/routers/`, not `src/server/api/routers/`; the audit model is
`AuditLog`, not `AuditEvent`.

**Tests**: `tests/pentestScanner.test.ts` (target validation incl. DNS
rebinding, argv-only invocation, JSONL parsing, timeout/kill, per-run network
lifecycle), `tests/pentestScanWorker.test.ts` (state transitions, scheduled-fire
PenTest creation, cancelled-job skip), `tests/pentest.router.test.ts`
(real-DB integration incl. tenant isolation and the entitlement cap). Fixture:
`tests/fixtures/nuclei-sample-output.jsonl`.

**Not done in Part 1** (explicitly deferred): Vulnerability record creation
from scan findings, CVSS scoring, control linkage, vulnerability management
UI, ZAP/Burp import connectors, domain-ownership DNS-TXT verification.

## Phase 5 Part 2 — Implementation Notes

Covers Phase 5 tasks 3-5 from the Implementation Plan table: parsing scan
results into `Vulnerability` records with best-effort control mapping, the
manual-findings CRUD, and CVSS scoring. UI (vulnerability list/filter
screens, severity badges) is still Part 3 — this part is backend only.

**Models/fields added** (migration `20260711152443_phase5_part2_vuln_enrichment`):
- `Asset` — new lightweight model (`id, organizationId, name, identifier,
  createdAt`) so a `Vulnerability` can optionally reference a specific
  scanned target instead of only a `Control`. PRD mentions "assets"; the
  Part 1 schema had no asset concept at all.
- `Vulnerability.assetId` (FK to the above), `.remediation` (text),
  `.cvssVector` (full CVSS v3.1 vector string, kept alongside the numeric
  `cvssScore` so it can be redisplayed/recalculated), and `.embedding`
  (`vector(384)`, see below).

**CVSS library**: [`ae-cvss-calculator`](https://www.npmjs.com/package/ae-cvss-calculator)
(metaeffekt) — chosen over `cvss-calculator` (last published 2022, stale)
and `cvss4` (~9k downloads/month vs. this package's ~1.2M/month). Actively
maintained, zero transitive dependencies, Apache-2.0, native TypeScript
types. Wrapped in `src/server/pentest/cvss.ts`
(`calculateCvssScore(vector) -> { score, severity, vector }`), used by both
auto-parsed findings and manual entry so scoring logic exists in one place.
Severity is derived from the base score via FIRST.org's own published
qualitative-rating thresholds (0=NONE, <4=LOW, <7=MEDIUM, <9=HIGH, else
CRITICAL) — verified in `tests/cvss.test.ts` against FIRST.org's own
CVSS v3.1 specification-document example vectors/scores, not invented
values.

**Result parsing** (`src/server/pentest/parseFindings.ts`): maps a nuclei
finding to severity/score by preferring a CVSS v3.1 vector when the
template's `info.classification.cvss-metrics` provides one (deriving both
score and severity from it), and falling back to nuclei's own `info.severity`
rating with `cvssScore: null` when it doesn't — most informational/misconfig
templates carry no CVSS metrics, and a fabricated score there would be
misleading. `remediation` is pulled from `info.remediation` when the
template provides it.

**Auto-mapping on scan completion**
(`src/server/pentest/autoMapVulnerabilities.ts`): hooked into
`pentestScanWorker.ts`'s existing `COMPLETED` transition (after the
`PenTest` row itself is marked completed, so a parsing/embedding problem
can never retroactively fail a scan that already succeeded). Resolves the
org's control by an exact case-insensitive title match on **"Vulnerability
Management"**, matching Appflow.md step 3 ("findings appear as
vulnerabilities linked to the 'Vulnerability Management' control"). **This
is a fragile string-match convention, flagged deliberately**: there is no
dedicated schema flag for "this is the well-known vulnerability-management
control," so an org that renames or never creates a control with this exact
title simply gets `controlId: null` on every auto-created row — never a
hard failure, but also silently un-linked. Worth revisiting once Phase 6's
cross-walking work needs a non-string way to identify well-known control
roles (e.g. a `wellKnownRole` enum field on `Control`).

**Embedding — deviated from the original task brief.** The brief assumed a
Phase 7 `OrganizationEmbedding` table already existed in the schema; it
doesn't (Phase 7 AI Advisor is still unbuilt, and that model only ever
existed in this doc's own future-scope sketch, never in `schema.prisma`).
It also asked for a "Graphify knowledge-graph edge" between Vulnerability
and Control nodes — there is no such runtime feature anywhere in this
codebase; Graphify here is the agent's own codebase-exploration tool, not
an application dependency. Instead: added `Vulnerability.embedding
vector(384)` directly on the model, matching the existing convention
already used by `Control.embedding` and `Evidence.embedding`, generated via
the same real, already-wired path `src/workers/classification.ts` uses for
Evidence (`getEmbedding()` from `src/workers/ollama.ts`, written with raw
SQL since Prisma has no native vector write support) — not the newer
`InferenceProvider`/`resolveInferenceProvider` abstraction, which exists in
`src/lib/ai/` but has zero call sites anywhere in the app yet. The
Vulnerability→Control relationship is already fully expressed by the
existing `controlId` foreign key; no separate graph/edge structure was
added. Embedding failures are caught and logged, never block vulnerability
creation (`src/server/pentest/vulnerabilityEmbedding.ts`).

**tRPC router** (`src/server/routers/vulnerability.ts`, registered as
`vulnerability` in `src/server/routers/index.ts`): `list` (cursor-paginated,
filterable by `penTestId`/`status`/`severity`/`controlId`), `getById`,
`createManual` (requires either `cvssVector` or an explicit `severity`;
`controlId`/`assetId`/`penTestId` are verified to belong to the caller's org
before linking), `updateStatus` (blocks reopening a `WONT_FIX` finding
without `force: true`, to prevent accidental status flapping),
`linkControl`, `trends` (Prisma `groupBy` on severity/status within a date
range — no in-memory aggregation, per TRD's performance principles). All
mutations audit-logged via the existing `AuditLog` mechanism with
SCREAMING_SNAKE actions (`VULNERABILITY_CREATED`,
`VULNERABILITY_STATUS_CHANGED`, `VULNERABILITY_CONTROL_MAPPED`), matching
`connector.ts`'s convention rather than the dotted `vulnerability.created`
style the task brief assumed (same `AuditLog`-not-`AuditEvent` gap as
Part 1).

**Tests**: `tests/cvss.test.ts`, `tests/parseFindings.test.ts` (against the
same `tests/fixtures/nuclei-sample-output.jsonl` from Part 1, extended with
a real `cvss-metrics` vector + `remediation` field on one entry — additive,
doesn't change Part 1's assertions), `tests/vulnerability.router.test.ts`
(real-DB integration incl. tenant isolation, RBAC, the CVSS-vs-explicit-
severity precedence rule, and the WONT_FIX reopen guard),
`tests/autoMapVulnerabilities.test.ts` (control-found and
control-not-found paths). `pentestScanWorker.test.ts` extended to assert
the new auto-mapping hook is called on the `COMPLETED` path. Full suite:
256 tests, 4 pre-existing unrelated failures (3 in `onboarding-router.test.ts`
from a stale Prisma mock missing `$transaction`, 1 a pre-existing timing
flake in `webhook.router.test.ts`'s delivery-ordering test — neither
touches any file this part changed).

**Not done in Part 2** (explicitly deferred to Part 3): vulnerability
management UI (list/filter/status-transition screens, severity badges,
risk heatmap), ZAP/Burp import connectors, semantic search over the new
`Vulnerability.embedding` column (nothing queries it yet — Part 2 only
populates it).