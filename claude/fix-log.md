# Remediation fix log — GRC-VAPT / launch-audit / qa-report

Started 2026-08-05. Branch `infra-audit-2026-08-04`.

## STEP 0 findings — read this before assuming any item is open

The brief's premises are substantially stale, in two distinct ways.

### 0.a The named vault docs do not exist

`1_PRD.md`, `2_TRD.md`, `3_APP_FLOW.md`, `4_UI_UX_DESIGN.md`, `5_BACKEND_SCHEMA.md`,
`6_IMPLEMENTATION_PLAN.md` — zero hits repo-wide (`find . -name "?_*.md"` returns only
`Dharma-Knowledge-OS/0_DESIGN_SYSTEM.md`). The vault is `Dharma-Knowledge-OS/` with
numbered *directories* (`00_START_HERE/`, `04_TECHNICAL/`, …). The schema is at
`packages/db/schema.prisma`, not `prisma/schema.prisma`. Substituted the real
equivalents: `04_TECHNICAL/Database_Design.md`, `Security_Architecture.md`,
`05_DEVELOPMENT/Development_Status.md`, `Coding_Standards.md`.

This is the second time a pasted master prompt has cited these filenames —
`LAUNCH_READINESS_REPORT.md` §2.1 records the same discovery on 2026-08-02.

### 0.b Most of WAVE 1–4 was already closed by a prior sprint

Commits `0e3e932` (stage-1) … `afe724f` (stage-6), plus `8e3bd7c` and `07d6db4`, already
fixed the majority of the WAVE 1–4 findings. Re-fixing them would churn working code.
Verified per item below.

### 0.c Named skills

`gstack`, `awesome-copilot`, `Graphify`, `obsidian-context`, `prisma-schema`,
`trpc-router`, `bullmq-setup`, `pgvector`, `ui-components`, `docker`, `audit-logging`
are **not installed as skills** in this environment (only `graphify` exists, and it is a
knowledge-graph tool, not a RAG-wiring codegen skill). Treated each as a labelled
checklist of conventions, held against the repo's own established patterns
(`Dharma-Knowledge-OS/05_DEVELOPMENT/Coding_Standards.md`).

### 0.d Harness

Already exists — no need to stand one up. `npm run test` (Jest, 81 suites),
`npm run test:e2e` (Playwright), `npm run type-check` (tsc --noEmit), `npm run lint`,
`npm run build`. Test DB isolated to `dharma_test` as of `acf75de`.

---

## Item status

Legend: **OPEN** = real work needed · **ALREADY DONE** = verified closed by a prior
commit, evidence cited · **MOOT** = premise no longer exists.

### WAVE 0 — VAPT authorization (the genuinely open wave)

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 0.1 Domain ownership verification (`VerifiedAsset`, DNS TXT challenge, gate on create) | **DONE** | Was open: `grep VerifiedAsset` → 0 hits, and `scanner.ts:21-27` carried an explicit `TODO(targetVerification)` saying ownership was asserted *only* by the `ownershipConfirmed` checkbox. Now: `VerifiedAsset` model + migration `20260805150000_…`, `src/server/pentest/assetVerification.ts`, `pentest.assets.{list,checkTarget,requestVerification,confirmVerification,revokeVerification}`, gate in `pentest.create` **and** in `pentestScanWorker`, UI sub-flow in `VerifyOwnershipPanel.tsx` + `NewScanModal.tsx`. | `tests/assetVerification.test.ts` (40), `tests/pentest.router.test.ts` "scan authorization gate" (12), `tests/pentestScanWorker.test.ts` (3 new) |
| 0.2 SSRF blocklist server-side | **DONE** | `validateScanTarget()` already existed (`scanner.ts`) covering RFC1918 / 127/8 / 169.254/16 / ::1 / fc00::/7 and IPv4-mapped v6, and was already called inside `runNucleiScan` — i.e. in the worker at dispatch time, which is what closes the DNS-rebinding window. The gap was that `pentest.create` never called it, so a `127.0.0.1` scan was *accepted* and queued, failing later instead of being rejected up front. Now called at create via `authorizeScanTarget()`. | `tests/pentest.router.test.ts` — 4 parameterized cases (127.0.0.1, 169.254.169.254, 10.0.0.5, ::1) |
| 0.3 Scan-authorization audit trail | **DONE** | New `PENTEST_SCAN_AUTHORIZED` action recording the authorizing asset, its verification method/timestamp, the admin who verified it and the admin who attested at scan time; plus `ASSET_VERIFICATION_{REQUESTED,CONFIRMED,FAILED,REVOKED}`. All through the existing hash-chained `createAuditLog`, not a parallel log. | `tests/pentest.router.test.ts` — "writes a PENTEST_SCAN_AUTHORIZED audit entry naming the authorizing asset" |
| 0.4 Distinct-asset anomaly signal | **DONE** | `src/server/pentest/scanAnomaly.ts` — Redis SET of distinct targets per org on a sliding 1h window, threshold 15. Advisory only: emits `PENTEST_SCAN_SPREAD_ANOMALY` to the audit log, never blocks, and returns null (no signal) if Redis is down. | `tests/scanAnomaly.test.ts` (5) — threshold boundary, breadth-not-volume, per-org isolation, and the Redis-unreachable→null path. Added 2026-08-06 via Cowork device bridge, where it could not be run (that sandbox had no network to fetch the missing SWC binary). **Executed 2026-08-06 on the owner's macOS host: 5/5 green in 0.26 s.** This row is now closed on evidence, and the "no dedicated unit test for 0.4" gap recorded under *Known gaps carried forward* is closed with it. |
| 0.5 AUP + abuse-response runbook | **DONE** | `docs/security/acceptable-use-policy.md` — what may be scanned, what the software does and does not enforce, and a 5-step abuse-response runbook with a revoke-first containment order. | n/a (doc) |

### WAVE 1

| Item | Status | Evidence |
|---|---|---|
| 1.1 Framework detail `use()` crash | ALREADY DONE | `LAUNCH_READINESS_REPORT.md` A1. Root cause was the inverse of the brief's: app is Next **14.2**, where `params` is a plain object, and the page used the Next 15 `use()` idiom. Fixed in both files that used `use()`; `tests/e2e/launch-readiness.spec.ts` A1. Segment error boundary added in `b0199f1`. |
| 1.2 Dead empty-state CTAs | ALREADY DONE / premise false | Report A5: the Pentests empty-state CTA was already wired identically to the toolbar button. E2E A5 pins the behaviour. |
| 1.3 SSO/SCIM blank page | ALREADY DONE | `b0199f1` — structured SSO loading state; "renders blank" was a bare full-height skeleton. |
| 1.4 Ollama embedding pipeline down | ALREADY DONE | `0e3e932` (stage-1). Two defects: `getEmbedding()` did `slice(0,384)` on a 768-dim `nomic-embed-text` output (every stored vector was meaningless noise) — fixed by `src/server/ai/embeddingModels.ts` + moving to `all-minilm`; and no readiness gate — fixed by `aiAdvisor.checkHealth`. `docker-compose.yml:160-205` has the ollama healthcheck, an `ollama-init` model-pull service, and `depends_on: condition: service_healthy`. Tests: `embeddingModels.test.ts`, `advisorHealth.test.ts`, `embeddingClient.test.ts`. |

### WAVE 2

| Item | Status | Evidence |
|---|---|---|
| 2.1 Session revocation | ALREADY DONE (scoped, documented) | Report §2.4 — auth is `strategy: "jwt"`, no `Session` rows are ever written, no MFA model, no passwords (Google OAuth + magic link only). The page ships what is real and states the gaps. `b24726c` additionally resolved "session expires" from the cookie's own `exp` claim. **Superseded by 2.1b — that scoping is no longer defensible now that SCIM deprovisioning ships.** |
| 2.1b Re-read the user row in `orgProcedure` (fullstack-audit BE-1) | **DONE** — `8af2274` | The 2.1 scoping said revocation was out of scope because there are no `Session` rows to delete. True, but it left the *consequence* unaddressed: the `jwt` callback populates `role`/`organizationId` only at sign-in, so a 30-day token kept full read/write access after `organization.removeMember` or SCIM deprovision set `isActive: false`, on the 25 routers not using `permissionProcedure`. Now `orgProcedure` resolves the row through `src/server/lib/sessionIdentity.ts` (30s Redis TTL as the guarantee; a Prisma `$use` middleware on User writes in `src/server/db.ts` collapses it to ~0 for in-app writes) and **overwrites** session role/org with DB values, so `managerProcedure`/`adminProcedure` became revocation-aware with no per-router change. Two deliberate design points: the cache holds **User scalars only, never the joined `CustomRole.permissions`** — caching that broke Phase 8's "permission changes take effect immediately" test, caught in this wave's own gate and fixed by reading `CustomRole` fresh off `customRoleId`; and a Redis outage falls through to a direct DB read rather than failing closed, so a cache blip can't become an auth outage. Documented in `04_TECHNICAL/Security_Architecture.md`. | `tests/sessionRevocation.test.ts` (8) — **6 of the 8 fail on pre-fix `trpc.ts`**, verified by reverting that one file; the 2 that pass in both are deliberate controls (active-member baseline, auditor-session bypass). Fixture fallout: 16 tests across 9 suites asserted a role **only in the session** while the seeded row said ADMIN — precisely the escalation BE-1 describes, so it is no longer a way to hold a role. Corrected via the shared `tests/fixtures/seedRoleUser.ts` rather than 6 copies. |
| 2.2 Roles page 0 members | ALREADY DONE | `b0199f1` — `roles.list` now returns `memberCount` = explicit `customRoleId` assignments + members on the matching legacy enum. Deliberately resolved at read time, not by backfill (a backfill would snapshot today's permissions onto every user and change authorization to fix a display bug). |
| 2.3 False-negative loading states | ALREADY DONE | `b0199f1` — Settings → General now branches on `isPending`/`isError`/`isSuccess` instead of `data?.x ?? fallback`. Marketplace blank count fixed in `b24726c` (`itemsData.total` → `count`). |
| 2.4 Destructive-action confirmation | ALREADY DONE | `b0199f1` — shared `src/components/ui/confirm-dialog.tsx` on report + schedule delete; `REPORT_SCHEDULE_DELETED` now records cron/recipients/enabled/reportConfig. |

### WAVE 3

| Item | Status | Evidence |
|---|---|---|
| 3.1 MinIO default credentials | ALREADY DONE | `8e3bd7c` — production secret guard in `src/env.ts`, `src/lib/storage/minioClient.ts`, `src/server/minio.ts`; README rotation steps. **To re-verify** the boot actually refuses on default creds. |
| 3.2 Stripe SDK global load | MOOT | Fixed once in `LAUNCH_READINESS_REPORT.md` B2 (route-scoped `StripeProvider`), then made moot entirely by `07d6db4`, which removed Stripe as a dependency. |
| 3.3 Duplicate framework seed data | ALREADY DONE | Report B1. Root cause: `packages/db/seed.ts` created `ISO 27001`/`SOC 2` stubs while `scripts/seed-frameworks.ts` upserts `ISO 27001:2022`/`SOC 2 Type II` — different names, so the upsert never matched. Demo org verified 5 → 3 frameworks. `tests/db.test.ts`. |
| 3.4 E2E pollution of the dev org | ALREADY DONE | `acf75de` — `envs/.env.test` now targets `dharma_test`; `scripts/setup-test-db.sh`; `scripts/clean-test-artifacts.ts` (190 orgs, 4 schedules, 4 endpoints, 4 API keys removed). Also surfaced that Organization deletion does not fully cascade (`MarketplaceItem.author`, `MarketplaceReview.reviewer` are `Restrict`) — **still open as a schema fix**, tracked below as 3.4b. |
| 3.4b Org delete does not cascade | **DONE** | Migration `20260805170000_marketplace_author_reviewer_setnull_on_user_delete`. Reproduced first: the audit named two blockers, but a systematic scan found five relations to `User`/`Organization` lacking an explicit `onDelete` — and an empirical repro showed **only two of the five actually block**. `PenTest.requestedBy` and `VerifiedAsset.requestedBy` are `Restrict` but harmless, because those models are tenant-scoped and the org cascade clears them before the `User` delete is attempted. `MarketplaceItem` and `MarketplaceReview` are the only models referencing `User` that are **not** tenant-scoped, so nothing removes them. Chose `SetNull` over `Cascade` for both: other tenants import these items (`ImportedItem.sourceItem` is already `SetNull`), so cascading would destroy one tenant's content to offboard another; and `ratings`/`reviewCount` are denormalized, so deleting review rows would silently overstate an item's rating. Verified the migration SQL alone (not just `db push`) leaves `prisma migrate diff` empty. Test: `tests/organization.cascade.test.ts` (5) — 3 fail on the pre-fix schema with the exact FK errors, 2 controls pass. |
| 3.5 Audit chain "verify integrity" action | ALREADY DONE | `src/server/routers/audit.ts:106` `verifyIntegrity`, wired in `src/app/dashboard/AuditLogViewer.tsx:228-235`. Tests `audit.appendOnly.test.ts`, `audit.test.ts`. |

### WAVE 4

| Item | Status | Evidence |
|---|---|---|
| 4.1 Per-route `<title>` | ALREADY DONE | Report B3 — 42 new `layout.tsx` + 2 inline; E2E B3 asserts every route has a distinct title. |
| 4.2 Cross-Walk truncation + matrix auto-population | SPLIT: truncation ALREADY DONE (Report B4a); auto-population deferred (B4b) | Re-assess now that 1.4's embedding fix (`0e3e932`) means vectors are no longer half-truncated noise — the original deferral predates that fix. **Reopened as 4.2b.** |
| 4.3 0/0 vs 0/N | ALREADY DONE | Report C2 (cards) + `b24726c` (distinct `unconfigured` severity band, excluded from `severityNeedsAttention`). |
| 4.4 "Sso" → "SSO" | ALREADY DONE | `afe724f` — explicit acronym map, fixed at the source. Also fixed a real 404: breadcrumbs linked `/dashboard/settings/enterprise`, which has no `page.tsx`. `tests/breadcrumbs.test.ts`. |
| 4.5 Humanized cron | ALREADY DONE | `b0199f1` — `src/lib/cronHumanize.ts`, raw expression preserved in `title`. `tests/cronHumanize.test.ts`. |
| 4.6 Marketplace blank count | ALREADY DONE | `b24726c` — see 2.3. |
| 4.7 Billing "Features Included" empty on Free | ALREADY DONE | `b24726c` — now leads with real allowances from `Plan.limits`. Deliberately not fixed by adding keys to `Plan.features`, which gates access in `services/entitlement.ts`. |
| 4.8 Enterprise sidebar grouping | ALREADY DONE | `b24726c`. |

---

## Remediation pass 2 — `claude/fullstack-audit-2026-08-06.md`

Started 2026-08-06. Baseline before any change: **90 suites / 736 tests green**,
`tsc --noEmit` clean, lint clean (6 pre-existing warnings). A live Postgres +
Redis are available, so every test below is a real-DB integration test unless
stated.

### Precondition — the uncommitted infra tree (DEV-3, DEV-10)

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| Commit the Helm-authoritative deploy tree | **DONE** — `ff8e091` | CI's deploy jobs referenced `helm/dharma/values-{staging,production}.yaml` by path while those files existed only in the working tree — a fresh clone of `main` would fail `helm upgrade -f ...` on a missing file. Reviewed each file rather than `git add -A`: DEPRECATED banners on `k8s/{nextjs,ingress}.yaml`, the NetworkPolicy selector migration in `k8s/namespace.yaml` (`app: nextjs` → `app.kubernetes.io/name: dharma`, which had to move *with* the banners because under default-deny a selector mismatch silently drops every app→data packet), `deploy.yml`'s move to `helm upgrade --install --atomic`, and the seal-secrets runbook. Answers `04_TECHNICAL/Deployment.md`'s k8s-vs-Helm Open Question in favour of Helm. | n/a (infra); verified by inspection of each diff |

### WAVE 5 — session revocation + marketplace authorization

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 5.1 Re-read the user row in `orgProcedure` (BE-1) | **DONE** — `c27d964` | See WAVE 2.1b above — logged there rather than duplicated, since it extends that item. | `tests/sessionRevocation.test.ts` (8); 6 fail pre-fix |
| 5.2 Marketplace hardening (BE-2, BE-5, BE-6, BE-7, BE-8) + orphaned routes (§4 HIGH-1, MEDIUM-1) | **DONE** — `5bfeb67` | Treated as **one** work item per audit pattern P2 — this was one module built to a different standard, not six defects. (a) `publishItem` had `// Basic check, in reality verify role is PUBLISHER or ADMIN` above a mutation with **no check** → `publisherProcedure`. (b) `isPublic` was client-settable and passed into `create`, making the whole `approveItem` moderation step bypassable with one boolean → removed from the input entirely; only approve/reject write it. (c) `approveItem` gated on `role === "ADMIN"`, i.e. *any tenant's* admin, so any customer could approve any other tenant's submission into the shared catalogue → new `User.isPlatformAdmin`, deliberately **not** a `Role` value (role is org-scoped) and **not** an `MsspGrant` (that shape fits scoped tenant-to-tenant reads, not deployment ownership), with **no API that sets it** so it cannot be escalated through the app. (d) `metadata: z.any()` → discriminated union per `ItemType` with `kind` injected server-side from the declared type, and every string bounded, because this JSON is imported by *other* tenants. (e) `importItem` now refuses never-approved items. (f) 4 × `throw new Error` → typed domain errors mapped to `TRPCError`; genuinely unexpected errors are rethrown rather than laundered into a friendly 4xx. (g) service takes `prisma` instead of importing the singleton. (h) `redis.keys("marketplace:public:*")` on every publish → O(1) generation counter in the cache key; `KEYS` blocks the single Redis thread shared by **all 14 BullMQ queues**, so this was shared-infrastructure risk, not a marketplace nit. (i) the 7 zero-inbound-link routes became a gated **Manage** nav group resolved by `user.navCapabilities` server-side — not client role-reading, which is the `?? fallback` anti-pattern WAVE 2.3 removed. (j) `/dashboard/{admin,publisher,controls}` are grouping segments with no `page.tsx`; breadcrumbs linked all three, prefetching a 404 — same defect `afe724f` fixed for `settings/enterprise`, found by checking *every* segment rather than the reported one. | `tests/marketplace.router.test.ts` (16) — **12 fail pre-fix**, verified by reverting router+service; 4 passing are controls. `tests/import.router.test.ts` (4), `tests/navCapabilities.test.ts` (9), 4 new cases in `tests/breadcrumbs.test.ts`. **Both replaced suites were mock-only and passed throughout the entire window the vulnerability was open** — that is why they were rewritten against the real DB. |

**WAVE 5 GATE: PASSED** — `tsc --noEmit` clean, lint clean (same 6 pre-existing
warnings), **92 suites / 774 tests green**, `npm run build` succeeds.

Migration `20260806120000_wave5_platform_admin_flag` verified with
`prisma migrate diff --from-migrations` against a pgvector-enabled shadow DB
(the 3.4b convention). The first attempt declared a **partial** index in SQL
that Prisma cannot express in the schema, so the two would never have matched —
caught by this check and resolved by dropping the index entirely, since the
only access path is `findUnique` by id. Two drifts remain and are
**pre-existing, not from this wave** (confirmed identical at HEAD): the
`vector` extension, and a removed `Control.path` index.

### WAVE 6 — Kubernetes/Helm parity with the (correct) Compose topology

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 6.1 Pentest worker on Helm (ARCH-1) | **BLOCKED** (gap made explicit) — `72431e6` | Compose isolates `pentest-worker` so only it holds the host Docker socket; `src/workers/index.ts` (the chart's worker entrypoint) never imports `pentestScanRunner`, so a Helm-deployed Dharma **accepted scans that then sat in Redis forever** — no consumer, no error, no UI signal. Deliberately **not** closed by mounting `/var/run/docker.sock` into a Pod: on Compose's single host that socket grants root on a host the operator already owns, but in a shared cluster it grants root on a node running other tenants' workloads — a silent **downgrade** of `Security_Architecture.md`'s isolation intent, not an equivalent. Instead the chart now **fails at template time** unless the operator states where scans run (`pentest.scanBackend=external`, or `kubernetes-job` which fails as not-implemented). An install that refuses beats a queue that swallows every scan. | `tests/helmChart.test.ts` — 5 guard cases incl. "never mounts the host Docker socket into a pod"; CI asserts the guard still refuses (`infra-validate.yml`) so it cannot be "fixed" by deletion |
| ↳ **What is needed to unblock 6.1** | — | (1) A **live Kubernetes cluster** to validate against — none is available in this environment (`helm`/`kubectl` are installed; no kind/k3d/minikube, no current-context). (2) An **owner decision on isolation approach**: per-scan Job with a scoped ServiceAccount, vs. a sandboxed runtime (gVisor/Kata), vs. a dedicated node pool with PodSecurity restrictions. The scan runner in `src/server/pentest/scanner.ts` shells out to `docker run`/`docker network create` and needs rewriting for whichever is chosen. | n/a |
| 6.2 `prisma migrate deploy` as a pre-upgrade hook (DEV-1) | **DONE** — `72431e6` | Neither deploy job ran a migration; `npm run db:deploy` existed and was never called by CI. New pods rolled out against the old schema. `--atomic` made this **worse**: pods pass `/api/health` (which doesn't exercise the changed queries), Helm declares the release healthy, and the app is broken with a green deploy. Now `templates/job-migrate.yaml` at `pre-install,pre-upgrade` / weight `-5`, `backoffLimit: 0` (a failed `migrate deploy` is rarely transient, and retrying concurrently against shared schema state is worse than failing fast). Failure aborts the release without touching running Deployments. | `tests/helmChart.test.ts` — hook annotations, command, no-retry, and rendering under **both** real values files |
| 6.3 `deploy.yml` verify step + smoke host (DEV-2) | **DONE** — `72431e6` | `describe deployment nextjs` NotFounds *after* a successful production rollout; `get pods -l app=nextjs` exits 0 printing nothing — a check that **looked** like it passed while verifying nothing, which is the worse of the two. Now uses the chart's real names/labels and asserts the selector matched a running pod. Smoke host moved off the hardcoded `dharma.example.com` placeholder to `vars.PRODUCTION_URL`, skipping loudly when unset. | `tests/helmChart.test.ts` "deployment naming" pins `dharma-app`/`dharma-worker` and the `app.kubernetes.io/name` label the NetworkPolicies select on |
| 10.3 `notify` job dependency graph (DEV-7) | **DONE** — `72431e6` | `needs: [deploy-production, deploy-staging]` only. When lint/test/build/scan failed those jobs were **skipped, not failed**, so `if: failure()` never matched — a red test on `main` sent no Slack message at all. Now `needs` every upstream job with `always() && contains(needs.*.result, 'failure')`. | Asserted by parsing the workflow (`needs`/`if` verified); actionlint in CI |
| 10.4 `infra-validate` templates the real values files + validates `k8s/` (DEV-5) | **DONE** — `72431e6` | The `helm` job templated **default** values plus a synthetic all-toggles-on `--set`, never `values-staging.yaml`/`values-production.yaml` — the only two files a real deploy uses. Both are now linted and templated. New `k8s-manifests` job runs `kubeconform -strict` over `k8s/*.yaml`; the workflow already triggered on `k8s/**` while validating nothing there. | CI job; `helm lint` verified locally against all three values files |
| 10.5 `CHANGE_ME` in the production secret guard (DEV-6) | **DONE** — `72431e6` | Adds a **substring** check, deliberately unlike the exact-match discipline elsewhere, because `CHANGE_ME` appears embedded in a connection URL — an operator can set a real host and keep the placeholder password, which no exact match catches. **Correction to the audit:** DEV-6's headline example overstated slightly — bare `nextauthSecret: "CHANGE_ME"` (9 chars) was **already** refused by the schema's existing `min(32)` rule. The real exposure was the URL-embedded and MinIO placeholders. | `tests/envInsecureDefaults.test.ts` (8); **3 fail pre-fix**. The suite asserts the guard's own message, not just that the variable is named — the first draft passed for the wrong reason because a ZodError also names it. |

**WAVE 6 GATE: PASSED at the verification level available** — `tsc --noEmit`
clean, **94 suites / 793 tests green**, `helm lint` passes against all three
values files, every workflow YAML parses, and the guard matrix
(`enabled+no-backend` → fail, `kubernetes-job` → fail, `external` → render,
default → render) behaves correctly.

> **VERIFICATION HONESTY — read before treating WAVE 6 as cluster-proven.**
> There is **no live cluster** in this environment. Everything above is
> verified by **client-side rendering only** (`helm lint`, `helm template`).
> `kubectl apply --dry-run=server` was **not** run, and the audit's ASSUMED
> item — whether `k8s/namespace.yaml`'s `LimitRange` max (cpu 2 / memory 4Gi
> per Pod) makes the Ollama Pod unschedulable, given Compose grants Ollama 8GB
> — **remains ASSUMED**. It is not upgraded to VERIFIED here.

### WAVE 8 — generalize the SSRF guard (extends WAVE 0.2)

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 8.1–8.3 `assertPublicHttpTarget` + all 5 call sites + redirect handling (BE-4) | **DONE** — `431e35a` | WAVE 0.2 built the right control and left it in `src/server/pentest/scanner.ts`, where only the scanner could use it — pattern P1 exactly. Lifted to `src/server/lib/net/assertPublicHttpTarget.ts`; **`scanner.ts` now imports it rather than keeping a copy**, so the two cannot drift. Wired into `siem-export.ts` (highest priority — it ships the *audit log*, so an unguarded target is an SSRF **and** an exfiltration channel), `webhookWorker.ts`, `saml.service.ts`, `jiraConnector.ts`, `oktaConnector.ts`. Hardened past the original: HTTPS-only unless a caller opts in (plain HTTP is what reaches the metadata endpoints); **every** resolved address must be public (one public + one private A-record is a rebinding primitive, not a partial success); redirects re-validated per hop with `maxRedirects: 0` at all five sites and `redirect: "manual"` forced so the platform can never follow a hop unvalidated; resolved addresses returned so a caller can pin the connection. | `tests/ssrfGuard.test.ts` (42). Every assertion is on the **rejection** path, with `global.fetch` replaced by a throw so a pass proves refusal happened **before any network I/O**. Includes a static check that no call site regressed to bare `fetch(` — **verified to fail when one call site is reverted.** |

**WAVE 8 GATE: PASSED** — typecheck clean, lint clean, **95 suites / 835 tests green**.

> **Residual gap (8.4, stated rather than claimed):** full **DNS-rebind
> simulation was not performed**. It needs a domain whose resolution can be
> changed between the check and the fetch, which this environment cannot
> provide. The re-resolution is instead asserted *structurally* — the guard
> resolves immediately before use and returns the addresses it checked. Closing
> this properly needs a controllable test domain (the same blocker already
> recorded for WAVE 0.1's DNS challenge).

Four existing unit suites (`siem-export`, `jira`, `okta`, `webhookWorker`) now
mock the guard. They test signing/auth/payload behaviour, and their fixture
hosts — including siem-export's **local 127.0.0.1 stub, which the guard now
correctly blocks** — are not reachable under a real guard. The static
no-bare-`fetch` check above means this mocking cannot hide a reintroduced hole.

---

## Remaining real work

1. ~~**WAVE 0.1–0.5**~~ — done (`27f3981`, `f65e661`).
2. ~~**3.4b**~~ — Organization delete cascade. Done (`fix/org-delete-cascade`).
3. **4.2b** — Cross-Walk matrix auto-population, re-assessed post-embedding-fix. **STILL OPEN.**

### Known gaps carried forward

- **WAVE 0.1 DNS challenge is not end-to-end tested** — completing a real TXT
  challenge needs a DNS zone the tests control. The resolver logic is unit-tested
  against an injected resolver, and the E2E asserts the *negative* half (confirming
  without the record published must fail). Closing this needs a real test domain
  from the owner.
- ~~**WAVE 0.4 has no dedicated unit test**~~ — closed 2026-08-06.
  `tests/scanAnomaly.test.ts` covers the threshold boundary, breadth-not-volume,
  per-org isolation and the Redis-down path, and has now actually been run green.
- **Jest does not exit on its own** (82 open handles from module-scope BullMQ
  `new Queue(...)` across 11 queue files). Pre-existing and already compensated:
  CI runs `npm test -- --forceExit`, documented at `.github/workflows/deploy.yml:130`.
  A real fix means lazy queue initialization across those 11 modules.

## Progress

- [x] STEP 0 context load + item-by-item verification (this document).
- [x] WAVE 0.
- [x] 3.4b — Organization delete cascade.
- [ ] 4.2b — Cross-Walk matrix auto-population.
