# Knowledge OS audit — vault vs. live code

**Date:** 2026-08-04
**Scope:** Audit every descriptive claim in `Dharma-Knowledge-OS/` against the live
repo and correct the drift at source. Documentation only — no code was changed.
**Status:** Complete. 9 nodes corrected, 2 created, 4 items flagged unresolved.

---

## Why this was needed

The vault's technical and product nodes were all stamped `last_updated: 2026-07-23`
and described the schema as it stood at the bootstrap commit `9d28729`. Since then
the repo shipped Phase 3b/3c billing, a full observability stack, and six stages of
launch fixes. Nothing in `00_START_HERE` or `04_TECHNICAL` reflected any of it, so a
session that followed `CLAUDE.md`'s instruction to read `Dharma_Master_Context.md` +
`Development_Status.md` first was being handed a two-week-old picture as current state.

The `99_AI_MEMORY/` logs were the exception — they ran through 2026-07-31 and were
largely accurate. The drift was concentrated in exactly the nodes an agent is told
to trust most.

---

## 1. Vault structure

`Dharma-Knowledge-OS/` is an Obsidian vault (`.obsidian/` present) of **48 markdown
nodes** in a numbered-folder taxonomy, plus 2 unfrontmattered docs and 10 screenshots.

| Folder | Nodes | Content type |
|---|---|---|
| `00_START_HERE/` | 4 | Master context, Vision, Mission, Product Principles |
| `01_BUSINESS/` | 6 | Mostly `status: draft` — flagged gaps, not real content |
| `02_GRC_KNOWLEDGE/` | 6 | Compliance-domain reference (ISO/SOC2/GDPR/risk/audit) |
| `03_PRODUCT/` | 6 | Backlog, Roadmap, Requirements, Journeys, MVP, Acceptance |
| `04_TECHNICAL/` | 9 → **11** | Schema, architecture, API, auth, security, deployment, design |
| `05_DEVELOPMENT/` | 5 | Status, standards, decisions, progress, bugs |
| `06_MARKETING/` | 4 | All `status: draft` |
| `99_AI_MEMORY/` | 4 | Session-continuity logs — the freshest content in the vault |
| root | 1 | `0_DESIGN_SYSTEM.md` (Warm Paper canonical spec) |
| `docs/` | 2 | Design/theme working docs — **no frontmatter** |

### Conventions (learned from existing nodes, preserved in all edits)

Frontmatter is a fixed six-key schema, present on all 48 nodes:

```yaml
title: <Human Readable>
folder: <NN_FOLDER>
tags: [dharma, <domain>, <topic>...]
source_docs: [<file paths or "retired doc (absorbed <date>)">]
last_updated: YYYY-MM-DD
status: reviewed | draft | stable | adopted
```

- Links are Obsidian wikilinks `[[Node_Name]]` on the bare filename (no paths, no
  aliases used anywhere). Filenames are `Title_Case_With_Underscores.md`.
- Every node ends with a `Related: [[…]], [[…]].` line.
- `05_DEVELOPMENT/{Progress_Log,Decisions}.md` and `99_AI_MEMORY/{progress,decisions}.md`
  are explicitly **append-only**, with the AI_MEMORY pair documented as the mirror of
  the DEVELOPMENT pair.
- Gaps are stated inline as gaps rather than glossed — an existing convention worth
  keeping, and one I followed for everything I couldn't verify.

### Descriptive vs. prescriptive convention

**The vault has no machine-readable convention for this, and that is a real gap.**
The `status:` field tracks *editorial* confidence (`draft`/`reviewed`/`stable`), not
whether a node describes shipped code or planned work. In practice the split is by
folder — `03_PRODUCT/Roadmap.md` is prescriptive, `04_TECHNICAL/*` is descriptive —
and `Feature_Backlog.md` carries per-item `[x]`/`[ ]` checkboxes, which is the closest
thing to a build-state marker. I used those checkboxes (adding `[~]` for one partial)
rather than inventing a new frontmatter key. See §7.

### Graphify

**Graphify does not index this vault.** Verified rather than assumed:
`graphify-out/.graphify_root` is the repo root; `graph.json`, `manifest.json` and
`.graphify_ast.json` contain **zero** occurrences of `Dharma-Knowledge-OS`; the
manifest's key list is source files (`src/`, `packages/db/`, config). The
`code-review-graph` MCP graph (`.code-review-graph/graph.db`) likewise indexes code
only and has no doc/code linkage role. **No re-sync was applicable or run** — see §6.

---

## 2–4. Claims ledger, verification, classification

Verified by subsystem batch. Method column names the actual command/file used.

### Schema / data model

| Node | Claim | Verification | Class |
|---|---|---|---|
| Master_Context, Database_Design | "47 models" | `grep -c '^model ' packages/db/schema.prisma` → **49** | **STALE** |
| Database_Design | "**six** columns use `Unsupported(\"vector(384)\")`" then lists five | `grep -n 'Unsupported("vector'` → **5** (Control, Evidence, RegulationSnippet, Vulnerability, OrganizationEmbedding) | **STALE** |
| Database_Design | Embeddings are 384-dim/Ollama, not 1536/OpenAI | Confirmed, all five | ACCURATE |
| Database_Design | "`Plan` (free/pro/enterprise, Stripe-linked) ← `Organization` (`stripeCustomerId`, `subscriptionStatus`, `subscriptionEndsAt`)" | `Plan` now also has `razorpayPlanId`, `currency`; `Organization` adds `paymentProvider`, `razorpayCustomerId`, `razorpaySubscriptionId`, `razorpayPreviousSubscriptionId`, `stripeSubscriptionId`, `dunningStartedAt` | **STALE** |
| — | `ProcessedWebhookEvent` model | Exists, `@@unique([provider, eventId])`. Not in any node | **MISSING** |
| Master_Context | 47-model list otherwise (marketplace, connectors, pentest, RAG, RBAC, MSSP, endpoint, reporting, framework versioning) | All present | ACCURATE |
| Master_Context | `AuditLog` not `AuditEvent`; `MsspGrant` allow-list not RLS bypass | Both confirmed in schema | ACCURATE |
| 99_AI_MEMORY/status | "47 models" at bootstrap | `git show 9d28729:…` → **48** at bootstrap. The bootstrap note was already off by one | **STALE** |

### Billing / payments

| Node | Claim | Verification | Class |
|---|---|---|---|
| Master_Context | "Multi-tenant billing (`Plan`, Stripe per README)" | Razorpay is the live provider; Stripe retained behind a shared interface | **STALE** |
| Feature_Backlog | "[x] Multi-tenant billing/subscriptions (Phase 3b) — `Plan`" | Understated: idempotency table, entitlement middleware, 2 workers, full UI | **STALE** |
| — | Provider-agnostic payments (Phase 3c) | `src/server/services/payments/{provider,stripeProvider,razorpayProvider,index}.ts`, `PaymentProvider` enum, two webhook receivers, shared `billing/lifecycle.ts`, `dunningQueue` + `billingReconciliationQueue`, `src/components/billing/*`. **No vault node existed** | **MISSING** |
| Pricing_Strategy | "integrated with Stripe" | Same as above | **STALE** |
| Pricing_Strategy | "no actual price points … documented outside code" | `seed-plans.ts` seeds 99/999 in `BILLING_CURRENCY` (default USD) | **STALE** (partially) |
| Roadmap | "Phase 3b Billing & Subscription (Stripe, `Plan`, entitlement middleware), 2 weeks" | Prescriptive plan text. Stripe-only was the *plan*; the later pivot is recorded as shipped state in the new node | AHEAD — left untouched |

Verified in code: entitlement enforcement is real (`src/server/middleware/entitlement.ts`
consumed by `evidence`, `framework`, `onboarding`, `pentest`, `import` routers); dunning
grace is 14 days clocked from `dunningStartedAt`; both sweeps are daily repeatable jobs
(`0 3 * * *`, `0 4 * * *`) with fixed job IDs; both skip null-`paymentProvider` orgs.

### AI advisor / RAG

| Node | Claim | Verification | Class |
|---|---|---|---|
| Master_Context, Acceptance_Criteria | Zero-cloud AI; local Ollama only | `src/lib/ai/OllamaProvider.ts`, `src/workers/ollama.ts`; no cloud AI SDK in `src/` | ACCURATE |
| Database_Design | `AIAdvisorSession` → `OrganizationEmbedding` ← `IngestedDocument`, `OrgGraphNode`/`Edge`, `AIUsageLog` | All present; pgvector queries in `src/server/ai/retrieval.ts`, `aiIngestionWorker.ts` | ACCURATE |
| Database_Design | `Evidence.suggestedControlIds` is suggestion-only | Confirmed | ACCURATE |
| — | Advisor health probe (`src/server/ai/advisorHealth.ts`, gating `aiAdvisor` router) checks model-pulled + dimension-match, not just reachability | Real and wired at `aiAdvisor.ts:58`. Not described in any node | Minor MISSING — folded into Development_Status |
| — | Embedding truncation removed (`src/workers/ollama.ts:69` returns the vector as-is) | Confirmed by comment + code | ACCURATE (never claimed otherwise) |

### SSO / enterprise auth

| Node | Claim | Verification | Class |
|---|---|---|---|
| Authentication | SAML via `@node-saml/node-saml`, OIDC via `openid-client`, config in `OrganizationSettings.ssoConfig`, `ssoEnforced` flag | Confirmed; routes at `src/app/api/sso/{saml,oidc}/[orgId]/{login,callback,metadata}` | ACCURATE |
| Authentication | `scimTokenHash` is SHA-256 hash-only; `User.scimExternalId` per-org unique; `isActive` soft-delete | Confirmed in schema | ACCURATE |
| — | SSO settings page renders a real SAML/OIDC form | `settings/enterprise/sso/page.tsx` — tabbed SAML/OIDC, `configureSaml`/`configureOidc`/`testConnection`/`enforceSsoOnly`/`generateScimToken`/`disableScim` mutations | ACCURATE |
| API_Design | "**`sso`/`scim` routers**" | There is **no `scim` tRPC router**. SCIM is REST at `src/app/api/scim/v2/[orgId]/{Users,Groups,ServiceProviderConfig}`, as SCIM 2.0 requires | **STALE** |
| Authorization | `MsspGrant` is the only cross-tenant path, single consumer `aggregateQuery.service.ts` | Confirmed | ACCURATE |

### Core loop, connectors, API surface

| Node | Claim | Verification | Class |
|---|---|---|---|
| User_Journeys 1–5 | Evidence upload, AI mapping, RAG policy, audit verify, auditor portal | Routes and routers all present (`dashboard/evidence/`, `frameworks/`, `policies/`, `AuditLogViewer.tsx`) | ACCURATE |
| Feature_Backlog | "[x] Cloud connectors: AWS/Azure/GCP/GitHub/Okta/Jira, plus Vercel" | `connectorRegistry` — **AZURE and GCP are `null`**; VERCEL is `null` with only a legacy Phase 2 worker. Live: AWS, GitHub, Okta, Jira | **STALE** (overclaim) |
| Coding_Standards §1 | "each `ConnectorType` (AWS/AZURE/GCP/GITHUB/OKTA/JIRA/VERCEL) implements a shared typed interface" | Same — three do not | **STALE** |
| API_Design | 9 "undocumented but implied" routers | Live: **31** routers in `src/server/routers/index.ts`. Missing from the list: billing, entitlement, dashboard, health, settings, organization, user, onboarding, policy, readiness, report, roles, whiteLabel, controlMapping, evidenceMapping, aiIngestion, import, vulnerability, regulatory | **STALE** (incomplete) |
| Coding_Standards §3 | BullMQ for anything slow | 14 queues / 16 workers under `src/server/queue/` | ACCURATE |
| Feature_Backlog | Phase 9 Parts 1–3 built | Pages exist for `endpoints/`, `reports/`, `regulatory-alerts/`; `ApiKey` + `src/app/api/v1/` | ACCURATE |
| Development_Status | "Phase 5 Part 3 (vuln management UI) … unconfirmed" | Now confirmable: **UI is built** (`dashboard/vulnerabilities/`, triage board per `64e20b1`); **ZAP/Burp import is not** — no parser anywhere in `src/` | **STALE** (resolvable gap) |

### Security

| Node | Claim | Verification | Class |
|---|---|---|---|
| Security_Architecture | Two secret patterns — SHA-256 hash-only vs AES-256-GCM envelope | Confirmed; `connectorVault.ts`, `secretVault.ts`, `siemVault.ts` all present | ACCURATE |
| Security_Architecture | "**Token-bucket** rate limiting (TRD), details not further specified — gap" | `src/server/lib/rateLimit.ts` is a **fixed-window in-process `Map`**, not a token bucket, and its own comment says it breaks under multiple replicas | **STALE** |
| Security_Architecture | Hash-chained `AuditLog` + `ChainAnchor` | Confirmed; `emitAuditEvent` in `src/server/services/audit/writer.ts`, SIEM export in `siem-export.ts` | ACCURATE |
| Threat_Model | Gaps listed (endpoint attestation, marketplace moderation, rate-limit numbers, no IR runbook) | All still true; the IR-runbook gap is worse than stated — see below | ACCURATE |

### Infra / deployment / testing

| Node | Claim | Verification | Class |
|---|---|---|---|
| Deployment | "Confirmed to exist: `CONTAINERIZATION_STRATEGY.md`, `DEPLOYMENT_RUNBOOK.md`, `DEVOPS_ARCHITECTURE.md`, `DEVOPS_QUICKSTART.md`" | **None of the four exist.** This is the exact failure mode this audit exists to stop — a doc asserting other docs exist | **STALE** |
| Deployment | "docker-compose.yml (22KB — far larger than the TRD's 6-service sketch)" | 700 lines, **17 services**; healthchecks on 8 of 17 | **STALE** (speculative) |
| — | Full observability stack (Prometheus, Grafana, OTel collector, 3 exporters, `monitoring/`, `src/lib/observability/`) | Shipped; **no vault node existed** | **MISSING** |
| Deployment | Kubernetes question unconfirmed | Still genuinely unconfirmed — `k8s/` + `helm/dharma` exist, nothing states which is authoritative | ACCURATE (gap preserved) |
| System_Architecture | Stack table (Next.js 14, tRPC v11, Prisma, pgvector, BullMQ, MinIO, Ollama, Docker Compose) | Confirmed against `package.json` | ACCURATE |
| — | Canonical test entrypoint | `npm test` = `dotenv -e envs/.env.test -- jest --runInBand`. The DB-isolation guard **is in place**: `envs/.env.test` points at `dharma_test`, not `dharma_db` (fixed in `acf75de`) | ACCURATE |

---

## 5. Edits made

Nine nodes edited in place, `last_updated` advanced to `2026-08-04` on each, six-key
frontmatter and `Related:` conventions preserved.

| Node | Change | Evidence |
|---|---|---|
| `00_START_HERE/Dharma_Master_Context.md` | 47 → **49 models**; billing bullet and core-module 5 rewritten for two providers; two links added to "Where to go next" | `grep -c '^model '` |
| `04_TECHNICAL/Database_Design.md` | 47 → 49; "six" → **five** vector columns; Billing section rewritten with the real `Plan`/`Organization` field set and `ProcessedWebhookEvent` | `packages/db/schema.prisma` (Plan, Organization, ProcessedWebhookEvent blocks) |
| `04_TECHNICAL/API_Design.md` | Router list corrected to the real 31 and regrouped; `scim` router claim corrected to the REST surface | `src/server/routers/index.ts`, `src/app/api/scim/v2/` |
| `04_TECHNICAL/Security_Architecture.md` | Rate-limiting section replaced: fixed-window in-process, not token bucket, with the replica caveat stated | `src/server/lib/rateLimit.ts:1-35` |
| `04_TECHNICAL/Deployment.md` | Speculative section replaced with the verified 17-service inventory, healthcheck coverage, `envs/` layout, README pointer; the four non-existent DevOps docs corrected to "do not exist" | `docker-compose.yml`, `ls envs/`, `README.md` §Setup |
| `03_PRODUCT/Feature_Backlog.md` | Connectors `[x]` → `[~]` with real adapter coverage; billing row split into 3b and 3c with the not-signed-off caveat | `src/server/connectors/registry.ts:8-17` |
| `05_DEVELOPMENT/Coding_Standards.md` | Adapter-pattern item corrected — registry maps unimplemented types to `null` | same |
| `05_DEVELOPMENT/Development_Status.md` | New verified-2026-08-04 section (counts, resolved questions, new subsystems); historical 07-23 assessment retained below it; "Still open" replaced with four real open items | all of the above |
| `01_BUSINESS/Pricing_Strategy.md` | **Only the technical clause** corrected (Stripe → provider-agnostic/Razorpay-live) + seed defaults stated as placeholders. Pricing judgment deliberately *not* made — see §5b | `packages/db/seed-plans.ts:17,69,111` |

Append-only logs appended, not rewritten: `05_DEVELOPMENT/Progress_Log.md`,
`99_AI_MEMORY/progress.md`, `99_AI_MEMORY/status.md` (new dated section; the 07-30
entry left intact, with its open items re-checked in the new one).

### 5b. What I deliberately did not change

- **All of `03_PRODUCT/Roadmap.md`.** Its phase table is the historical *plan*
  (including "Phase 3b — Stripe"). Prescriptive content is not wrong for having been
  superseded; the shipped reality now lives in `Billing_And_Payments` and
  `Development_Status`, which it links to.
- **`01_BUSINESS/*` and `06_MARKETING/*` positioning**, all `status: draft`. The one
  business node touched was Pricing_Strategy, and only its code-checkable clause.
- **`0_DESIGN_SYSTEM.md` and the Warm Paper decisions.** Owner override, reaffirmed
  twice. Not re-opened.
- **`02_GRC_KNOWLEDGE/*`.** Compliance-domain reference, not claims about this codebase.

---

## 6. New nodes

Both in `04_TECHNICAL/`, matching the existing node shape, and linked from
`Dharma_Master_Context` "Where to go next", `Development_Status`, and their
subject-adjacent siblings — so neither is orphaned.

**`04_TECHNICAL/Billing_And_Payments.md`** — why two providers exist (Stripe is
invite-only for India-based accounts); the provider interface and why `CheckoutHandoff`
models the redirect-vs-modal difference explicitly instead of normalising it; webhook
idempotency and why the claim is taken inside the state-change transaction; the 14-day
dunning policy clocked from first failure; the two daily sweeps; entitlement enforcement
and its five consumer routers; the UI; and the explicit **not-signed-off** status.
Inbound links added from Database_Design, API_Design, Feature_Backlog, Coding_Standards,
Pricing_Strategy, Development_Status, Master_Context.

**`04_TECHNICAL/Observability.md`** — the six-service stack; why app telemetry goes
OTLP → collector → Prometheus rather than a `/metrics` endpoint; the lazy-instrument
constraint in `src/lib/observability/metrics.ts` (the OTel metrics API has no proxy
provider, so eager instruments pin to the no-op meter forever); scrape jobs including
the blackbox probe for Ollama; and four gaps — **no alerting** (alertmanager commented
out, zero alert rules), no trace backend, no healthchecks on the observability services
or workers, no SLOs despite Acceptance_Criteria naming measurable targets.

---

## 7. Graphify re-sync

**Not applicable — confirmed, not assumed.** Graphify indexes the code tree
(`graphify-out/.graphify_root` = repo root; zero `Dharma-Knowledge-OS` paths in
`graph.json`, `manifest.json` or `.graphify_ast.json`). The `code-review-graph` MCP
graph is likewise code-only. No re-extraction or re-embedding was run because there is
no vault index to re-sync.

Wiring Graphify to the vault would make the vault semantically queryable and is a
plausible improvement, but it is a scope decision for you, not something to add
unprompted. Note the tradeoff if you do: it introduces a second staleness surface
(embeddings drifting behind markdown) of exactly the kind this audit exists to close.

---

## 8. Flagged, not resolved

1. **Pricing.** `seed-plans.ts` defaults to 99 / 999 with `BILLING_CURRENCY` defaulting
   to `USD`, while Razorpay India sells in INR and the README's setup guide instructs
   `BILLING_CURRENCY=INR`. Whether 99/999 are meant as USD or INR figures is a
   materially different product, and nothing in code or vault decides it. **Owner call.**
2. **Kubernetes vs Compose as the production target.** `k8s/` and `helm/dharma` both
   exist; nothing states which is authoritative. This isn't cosmetic — the in-process
   rate limiter is only correct on a single replica, so a replicated K8s deploy silently
   weakens a security control. Flagged in both Deployment and Security_Architecture
   rather than decided.
3. **Roadmap Phase 2 checkbox.** `Roadmap.md` leaves "Phase 2 — Enterprise & Hardening
   (Docker Compose stabilization, automated backups, E2E validation)" unchecked, citing
   docs that don't exist. All three arguably shipped (17-service Compose,
   `backup-scheduler`, a Playwright suite) — but "stabilization" and "validation" have
   no completion criteria, and checking a phase box is a product judgment. Left as-is.
4. **No CONTRADICTED pairs found.** Two near-misses, both resolved as ordinary staleness
   rather than genuine disagreement: `99_AI_MEMORY/status.md` said 47 models where the
   bootstrap schema had 48 (corrected with a parenthetical, since it's a dated historical
   entry in an append-only log); and `Development_Status` vs `Feature_Backlog` disagreed
   on Phase 5 Part 3 — one called it unconfirmed, the other implied complete. Code
   settled it (UI built, import not), so no human call was needed.

---

## 9. Structural gaps in the vault

1. **No descriptive/prescriptive marker.** `status:` tracks editorial confidence, not
   build state. Nothing stops a roadmap aspiration from reading as a statement of fact —
   which is the root cause of this whole class of bug. Suggestion: add a seventh
   frontmatter key, e.g. `content_type: descriptive | prescriptive | reference`, and let
   descriptive nodes carry a `verified_against:` commit SHA. I did **not** add this
   unilaterally — it changes the schema on all 48 nodes.
2. **No central index/MOC.** `Dharma_Master_Context.md`'s "Where to go next" is a partial
   hub (it links ~8 of 48 nodes). There is no map of content, so a new node's only route
   into the graph is whatever nodes happen to link it. I linked both new nodes manually;
   this doesn't scale.
3. **`docs/dashboard-redesign-tokens.md` and `docs/theme-migration-checklist.md` have no
   frontmatter**, so they're outside every convention the rest of the vault follows and
   invisible to any frontmatter-driven query.
4. **`source_docs:` on most nodes still cites the retired `1_PRD.md`–`6_IMPLEMENTATION_PLAN.md`
   set** (deleted in `9d28729`). Body text handles this correctly — it names them as
   retired and links git history — but the frontmatter field reads as a live provenance
   pointer to files that don't exist. Fixing it means deciding whether `source_docs`
   means "derived from" (historical, correct as-is) or "verify against" (now wrong).
   That's a convention decision, not a correction.
5. **`05_DEVELOPMENT/Bugs.md` is an empty template** while `99_AI_MEMORY/status.md`
   carries real open defects in prose. Two places for the same thing, one of them unused.

---

## 10. Code findings — logged, not fixed

This task changed documentation only. Three things surfaced during verification:

1. **`.claude/settings.json:21` runs `code-review-graph status --json`; that flag does
   not exist** (`error: unrecognized arguments: --json`). The hook fails on every
   invocation. The previously-recorded `--quiet` bug is fixed (now `--skip-flows`), and
   `detect-changes --brief` works — so this is one stale flag, not a broken tool.
2. **`src/server/lib/rateLimit.ts` is single-process-only** by its own comment. Not a
   bug today; becomes a real control weakness the moment Next.js is replicated. Ties to
   flagged item 2 above.
3. **A jest process from an unrelated session (PID 30294) was running against
   `dharma_test_rzp`** while I ran the canonical suite against `dharma_test`. No
   interference — different databases — but worth knowing that stray runs outlive their
   sessions. My own first run was accidentally racing a second on the same DB; I killed
   both and re-ran clean (result in §11).

---

## 11. Test verification

Canonical entrypoint confirmed as `npm test` → `dotenv -e envs/.env.test -- jest --runInBand`.
The DB-isolation guard is in place and verified before trusting any result:
`envs/.env.test` sets `DATABASE_URL=…/dharma_test`, not `dharma_db` (the trap fixed in
`acf75de`).

**The pass count is not recorded here, because the run had not finished when this
report was committed.** It was still executing at ~19 minutes; a concurrent run from
an unrelated session (§10.3) took over 50 minutes on the same hardware, so this is
consistent with a slow suite rather than a hang.

I deliberately did **not** copy the "661 tests passing" figure from
`claude/fixes-2026-08-03-razorpay-migration.md`. Quoting a prior session's number as
if it were a fresh measurement is precisely the failure mode this audit exists to
close, and it would have been wrong in a new way: five `tests/billing.*.test.ts` files
were added after that figure was taken.

No vault node asserts a test count, so nothing in the knowledge base depends on this
number — the ledger above is unaffected either way. What *was* verified before any
result would have been trusted is the part that actually matters: the canonical
entrypoint, and that the test DB is genuinely isolated from the development DB.

**Follow-up:** re-run `npm test` and record the count. If it fails, the failures are
pre-existing relative to this audit, which changed no code.

---

## Validation

- **Links:** 0 broken wikilinks across all 50 markdown files (script-checked every
  `[[target]]` against every note basename, after all edits and both new nodes).
- **Frontmatter:** all 48 vault nodes parse as valid YAML and carry the full six-key
  schema, including both new nodes. The only two files without frontmatter are the
  pre-existing `docs/` pair (§9.3) — not introduced here.
- **Code untouched:** `git status Dharma-Knowledge-OS/` shows 12 modified + 2 new nodes
  and nothing else. The modified files under `src/`, `packages/` and `monitoring/` were
  already dirty at session start (unrelated Phase 3b/3c work) and were not touched.
