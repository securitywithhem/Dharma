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


### WAVE 9 — the seven open GitHub issues (#20–#26)

**STEP 0 first, per this document's own convention.** The issues were filed
2026-08-05 against the state of the repo at that time. Three were already
closed by earlier waves and were verified against HEAD rather than re-built —
re-implementing finished work is the failure mode this log exists to prevent.

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| **#23** MinIO default credentials | **ALREADY DONE** — `8e3bd7c`, `72431e6` | Verified at HEAD, not assumed: `envs/.env.example:46` ships `TODO_GENERATE_MINIO_ACCESS_KEY` (no working default); `src/env.ts:112-115` lists `minioadmin`/`minioadmin_change_me` in the production insecure-default matrix and `:137` adds the `CHANGE_ME` substring check; `docker-compose.yml:28,60,90-91` uses `${VAR:?required}` for Postgres, Redis and MinIO alike, so the whole stack refuses to start on a missing credential rather than only MinIO. Every acceptance criterion is met by existing code. | `tests/envInsecureDefaults.test.ts` (8) |
| **#20** VAPT target ownership | **PARTIALLY DONE** (`27f3981`, `f65e661`) → **now closed** | WAVE 0 built the challenge, the `VerifiedAsset` model, enforcement at `pentest.create` AND at dispatch, the anomaly signal, the dedicated authorization record, and `docs/security/acceptable-use-policy.md` incl. the abuse runbook. **One criterion was genuinely open: "Verification expires and requires re-proof."** A proof of control was good forever, so an org that verified `acme-staging.com` in January and let the registration lapse in June still had Dharma pointing scan traffic at a stranger's infrastructure in August — the issue's own legal exposure, reached by a different route. Added `VERIFICATION_VALIDITY_DAYS = 90`, `isVerificationCurrent()`, and a **separate** `VerificationExpiredError`: "you never verified this" and "your proof went stale" have different fixes, and an operator told the wrong one goes looking in the wrong place. Surfaced as an `EXPIRED` reason on `checkTarget` so the New Scan modal offers re-verification rather than first-time setup. | `tests/assetVerificationExpiry.test.ts` (10) |
| **#21** SSO page never renders | **DONE** | The missing `isError` branch had already been added; **it was not sufficient, and the reason is the actual finding.** Root cause is in `src/hooks/trpc.tsx`, not the page: (a) `httpBatchLink` had **no fetch timeout**, so a hung server request never settles — `isLoading` stays true forever and *no* error branch can ever run, because the page is never told; (b) React Query's default `retry: 3` re-asked a `FORBIDDEN` — a definitive answer — four times over ~7s while the user watched a spinner. Both fixed at the provider, so every page in the app is covered rather than the one that got reported. Page-level: the error branch now distinguishes permission / entitlement / broken and only offers Retry where retrying can help; added an explicit "no IdP configured yet" empty state. | `tests/sso.getConfig.test.ts` (7) — pins that the no-config path RESOLVES rather than throwing (the issue's prime suspect), that a corrupt stored config degrades to null instead of throwing, and that the OIDC secret envelope never reaches the client |
| **#22** Session revocation | **DONE** — the largest genuinely-open item | `User.sessionsValidFrom` + a `sessionIssuedAt` JWT claim, compared in `enforceOrganizationContext` so revocation takes effect **on the next request**, not at next sign-in. Org-wide + per-user switches, both audit-logged; `maxAge` 30d → 7d idle with hourly re-issue. Three decisions worth the reader's time, all recorded in `99_AI_MEMORY/decisions.md`: the cutoff lives on `User` (not `Organization`) so the per-request identity read stays a single indexed PK lookup; it uses **our own claim, not `iat`**, because NextAuth rewrites `iat` on every re-encode and a cutoff compared against it would be defeated by the stolen session simply staying active; and `revokeAllSessions` **does not exempt the caller**, since that exemption covers exactly the session an escalated attacker holds. Option C (database-backed sessions) recorded as a deliberate deferral with a 2026-11-07 revisit date. Security settings page rewritten to state the posture rather than list absences. | `tests/sessionKillSwitch.test.ts` (13) — **5 fail with the guard disabled**, verified |
| **#24** Destructive actions unconfirmed | **DONE** | Swept all of `src/app` + `src/components`, not the two paths in the QA report. Found **six** unconfirmed destructive click handlers, none of them the two reported: team member removal, endpoint revoke, API-key revoke, MSSP grant revoke, custom-role delete, webhook delete. All now route through `ConfirmDialog` naming the record and stating the consequence; added type-to-confirm for actions whose blast radius is invisible from the UI (API-key revocation, org-wide session revocation). Server-side audit coverage on delete paths was **verified exhaustively, not assumed** — all 11 already write an `AuditLog` entry. Soft-delete decision recorded (NOT adopted; a tombstone silently defeats erasure requests, and the hash-chained log already records who destroyed what). | `tests/destructiveActions.test.ts` (5) — a static sweep, **verified to fail when one call site is reverted**. Chosen over behavioural tests deliberately: the property is "no path anywhere is missing this", and the two reported paths were not special, just the two that happened to be clicked |
| **#25** Advisor fails silently | **DONE** | The typed-error and degraded-banner halves already existed. Genuinely open: (a) `health.checkAll` only proved the Ollama **process** answers `/api/tags` — a deployment with the embedding model unpulled, or emitting the wrong dimension, read GREEN while the advisor was completely non-functional. Wired `checkAdvisorHealth()` in as its own `embedding` check. (b) No alerting → now `opsAlert`, CRITICAL for `DIMENSION_MISMATCH` (never self-heals, silently poisons stored vectors) and WARN for reachability (usually a restarting container; paging on it trains the operator to ignore the channel). (c) **`sendMessage` had no `onError`** — a mid-conversation failure left the user's question in the transcript with no reply under it, which reads as "the advisor had nothing to say", i.e. as an all-clear. Failed turns now render as a persistent `role="alert"` entry, deliberately NOT a MessageBubble, saying no assessment was performed. | `tests/advisorFailureIsLoud.test.ts` (7) — proves the three outcomes (backend broken / nothing found / real answer) are **mutually exclusive and structurally distinguishable**, incl. an explicit guard against a future author "gracefully" mapping an outage onto the insufficient-context copy |
| **#26** Verify audit chain in the UI | **DONE — and it was hiding a production hazard** | The button already existed. Behind it, `verifyIntegrity` did an **unbounded `findMany` of the organization's entire audit log into the request thread**. Fine on the demo org; on the customer this feature is *for*, it is the feature falling over. Rewrote as a chunked keyset walk (`chainVerification.ts`) carrying only the previous hash across page boundaries — memory bounded by page size, not by the log's length. Added the `[organizationId, timestamp, createdAt, id]` composite index, with `id` as the tiebreaker the original ordering lacked: two entries in the same millisecond made keyset pagination unstable, which would report a chain break that does not exist — **a false accusation of tampering, which for this feature is worse than missing a real one.** Then the four scope items: range selection, BullMQ background job for large chains (sync refuses above 25k rather than silently truncating and issuing a false attestation), signed PDF via the existing `pdfSigner` pipeline, and a nightly sweep with a CRITICAL alert. `AuditVerificationStatus` has a distinct `ERRORED` because "we could not check" and "we checked and it is broken" demand opposite responses. | `tests/chainVerification.test.ts` (14) — all three tamper modes performed against **real rows** (modify in place, delete, delete-and-repair-the-back-link), each located; multi-page chains; tampering in a *later* page; and the partial-range honesty property |

**WAVE 9 GATE: PASSED** — `tsc --noEmit` clean.
**873 tests passing, up from 817**, with the **identical** 4 pre-existing
failing suites before and after (`audit.pipeline`, `framework`, `siem-export`,
`sso.oidc.service` — all missing env keys the jest environment does not load).
Baseline established by `git stash` + full serial run, both directions, rather
than asserted.

> **Run tests with `--runInBand`.** Under the default parallel run these suites
> contend on the single live Postgres and four *additional* suites flap
> (`aiIngestion.router`, `import.router`, `sso.roles.router`,
> `vulnerability.router`) — all four pass in isolation. This is pre-existing
> shared-fixture contention that the 56 new tests made easier to hit; it is
> **not** a regression, and it is stated here rather than quietly worked around.

---

### WAVE 7 — Policies lifecycle (the audit's other CRITICAL)

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 7.1 `policy.getById/update/publish/unpublish/delete` + schema | **DONE** — `51a9568` | The router exposed only list/create/listTemplates/generateFromTemplate/reviewDraft/getReviewStatus, and `isPublished` was settable **only at create time** — so the flagship AI-drafted-policy feature produced write-only documents. Adds `Policy.publishedAt` (distinct from `updatedAt`, which moves on every edit — "when did this become the document we attest to" is the auditor's question) and `Policy.deletedAt` (soft delete: a once-published policy is an attestable artifact, and the hash-chained AuditLog rows referencing its id are immutable, so the row must outlive the user's decision to remove it). **Editing a published policy bumps `version` and returns it to draft** — silently changing text under a "Published" badge would make the badge a lie; retitling does not, since that is not the text anyone attested to. `unpublish` added so publication is not a one-way door. Cross-tenant reads return NOT_FOUND, not FORBIDDEN, so the endpoint cannot probe which ids exist elsewhere. | `tests/policy.lifecycle.test.ts` (22) — the **whole suite fails to compile** against the pre-fix router, since none of the procedures existed |
| 7.2 `policies/[id]/page.tsx` | **DONE** — `51a9568` | TipTap review page reusing the builder's exact StarterKit + Markdown pairing — a second editor setup would let the markdown round-trip drift between the two pages. Publish/withdraw/delete, AI review, shared `ConfirmDialog`. Editor seed guarded on a dirty flag so a background refetch cannot discard in-progress edits. | covered by 7.4 E2E + `policies.page.test.tsx` |
| 7.3 List page: links, three-way state, empty-state CTA | **DONE** — `51a9568` | `data?.map(...)` followed by an `=== 0` check meant **loading AND error both rendered a bare heading**. Cards were not links (no route into a policy at all). Empty state had no CTA and the header had no action — the only route into the builder in the whole app was the dashboard's QuickActionsCard. | `tests/policies.page.test.tsx` (9) — **6 fail pre-fix**; the 3 that pass are controls |
| 7.4 E2E through the real journey | **DONE** — `51a9568` | Extends `tests/e2e/policy.spec.ts` through save → find in list → open → edit → publish → survives reload. Drives the **UI**, because the finding was that the journey had no path through the interface — only a UI-level test pins that. | `tests/e2e/policy.spec.ts` (2 new) |

Also renamed `user.navCapabilities` → `user.capabilities` and added
`policiesWrite`, which mirrors the server gate (`managerProcedure` →
`hasManagementAccess`) **exactly**, so the UI can never render a control the
API refuses. The endpoint was never only about navigation.

**WAVE 7 GATE: PASSED** — typecheck, lint, **97 suites / 870 tests**, build with
`/dashboard/policies/[id]` rendered.

### WAVE 9 — RBAC retrofit + UI generalization

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 9.1 RBAC retrofit (BE-3) | **DONE** — `5a11909` | `permissionProcedure` was on 6 of 31 routers; **19 now**. Chose the retrofit over stripping keys from the Roles UI because the machinery was already correct — only its application was missing (pattern P1). The swap is behaviour-preserving for legacy roles **only because** `LEGACY_ROLE_PERMISSIONS[COMPLIANCE_MANAGER]` mirrors `hasManagementAccess`; that equivalence is now **asserted directly** rather than assumed. Two cases needed judgement, not a mechanical swap: **`report.ts`** was admin-gated while the legacy manager set contained `reports.generate`, so swapping it alone would have handed every manager report access as a side effect of a security fix — removed that key from the manager set in the same change (same reasoning the file already applies to `audit.read`). **`billing.ts`** mutations were on bare `orgProcedure` with **no gating at all** — any org member could change billing details, start a checkout, or cancel the subscription; this retrofit **narrows** access to what the Roles UI already promised. Left alone deliberately: `apiKey`, `endpoint`, `regulatory`, `settings`, `webhook` gate on admin/manager with no matching key, and inventing one would be a guess at product intent. | `tests/rbac.retrofit.test.ts` (43) — both halves: a custom role revoking each of the 12 keys is refused, **and** legacy roles are unaffected |
| 9.3 Dialog focus trap + a11y (§6 MEDIUM-1) | **DONE** — `e5f1e69` | `dialog.tsx` said "Trap focus inside modal" above an effect handling **only** Escape — no containment, no initial focus, no restore, no `aria-labelledby` despite `role="dialog"`/`aria-modal`. Pattern P4's dangerous kind: a reviewer reads the comment and stops. Fixed in the primitive, so all six modals are fixed at once. **Trap worth recording:** the usual `offsetParent !== null` visibility shorthand is wrong here — it is null for `position:fixed` elements (which this dialog is) and always null under jsdom, so it would have emptied the focusable list and silently degraded the trap to "focus the container" while looking correct. Uses `checkVisibility()` with a visible-by-default fallback. | `tests/dialog.focusTrap.test.tsx` (11) — keyboard-driven, incl. the audit's exact repro; **10 of 11 fail pre-fix** |
| 9.4 `window.confirm` migration (§6 MEDIUM-2) | **DONE** — `e5f1e69` | Grepped the whole app rather than trusting the two named sites; those two were in fact all of them. `imported-items` also had an `alert()` for errors, now a toast. Both dialogs name what is about to be destroyed — the descendant count on a control delete is the entire point of the warning and a one-line native dialog cannot emphasise it. | `tests/errorStateCoverage.test.ts` asserts **zero** native confirm sites app-wide |
| 9.2 / 9.5 Error-state sweep + shared component (§6 HIGH-1) | **DONE** — `b98a4af` | Adds `src/components/ui/query-error.tsx` and adopts it across 8 pages rather than hand-rolling a ninth copy. `cross-walk` had **no loading, error or empty state at all**. `settings/connectors` delegates entirely to `ConnectorsList`, so the boundary went there. | `tests/errorStateCoverage.test.ts` (25) — a **static** check, because the defect is an ABSENCE spread across files and the failure mode is someone adding an eleventh page without one |

> **CORRECTION TO THE AUDIT (§6 HIGH-1).** The state-coverage table counted
> occurrences of `isError` only, and reported `/dashboard` as having "12 loading
> indicators and zero error branches". **That is wrong.** `dashboard/page.tsx`
> destructures `error` (not `isError`) and has always rendered a distinct
> `<LoadFailure/>`; the audit's own repro would have shown an error card, not a
> zero state. Re-surveyed counting both spellings, the genuine gap was **eight
> other pages**. /dashboard's real shortcoming was no retry affordance — its
> copy asked the user to refresh the browser by hand — now a button.

**WAVE 9 GATE: PASSED** — typecheck, lint, **100 suites / 949 tests**, build.

### WAVE 10 — observability (remaining items)

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 10.1 Prometheus rules + one alerting path (DEV-4) | **DONE** — `8d7a8f7` | `rule_files: ["rules/*.yml"]` pointed at a directory that **did not exist**, and Prometheus tolerates a non-matching glob **silently** — starts clean, logs nothing, loads zero rules. Alertmanager was commented out. Adds 11 rules and routes them to the **same** `OPS_ALERT_WEBHOOK_URL` the app's `alert.ts` uses: one destination, since the app alerts on what only it can see and Prometheus on what only outside observation can (a dead process cannot report itself). Uses Alertmanager's `url_file` against `monitoring/secrets/` — the repo's existing convention — chosen **after** `amtool check-config` rejected a templated config: an alerting config no tool can validate is how DEV-4 happened. Also avoided compose's `${VAR:?}`, which interpolates the whole file and would have broken `docker compose up postgres`. | `tests/monitoringRules.test.ts` (18); verified with real tooling — `promtool check rules` → 11 rules, `amtool check-config` → SUCCESS |
| 10.2 `auth_attempts_total` panel (DEV-8) | **DONE** — `8d7a8f7` | Adds an Authentication row: attempts by status, failure ratio, attempts by method. Split by status deliberately — a rising total is meaningless without knowing whether the extra attempts succeed. | same suite; asserts existing panels and grid positions are undisturbed |
| 10.6 Restore drill in CI (DEV-10) | **DONE** — `8d7a8f7` | The 2026-08-04 drill was real but ran once, by a session that has ended. `.github/workflows/backup-restore-drill.yml` seeds recognisable data, backs up, **destroys**, restores, and asserts a **content checksum** — not a row count, which would pass on a restore returning the right number of wrong rows. Scheduled, not per-PR: it changes when the backup scripts change, and the slowest check in a repo gets skipped. | CI workflow (scheduled); YAML validated |

### WAVE 11 — scoring semantics + frontend housekeeping

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 11.1 `Control.status` vs the score (ARCH-4) | **DONE** — `74c3e10` | **Product decision, made by me: option (b).** Score stays evidence-driven; the UI now says so. Rejected option (a) because evidence is an artifact an auditor can inspect and a self-assessed status is not — a headline number a user can move by ticking boxes is worth less to the auditor it exists to convince — and because (a) would silently restate every existing org's score overnight. Said in **three** places including the control detail modal, where the status is actually set; telling users only on the score page still leaves them setting a field whose irrelevance they learn elsewhere. | `tests/scoringSemantics.test.ts` (13) — asserts the scorer **still** ignores status, so a later option-(a) implementation fails here and prompts updating the UI copy in the same change |
| 11.2 Code-split the Advisor (§8 MEDIUM-1) | **DONE** — `74c3e10` | Mounted in the dashboard layout, so a static import put the whole Advisor tree on every dashboard route for every user; `grep -rn "next/dynamic" src` returned **zero** hits app-wide. Now `next/dynamic` + `ssr:false`, and not mounted until first open so the chunk is not even requested otherwise. **MEASURED, because the audit assumed a win Next's route table does not show:** `/dashboard` reports 196 kB First Load JS before *and* after (that column is dominated by shared framework chunks). The real effect is the dashboard **layout chunk**, loaded on every dashboard route: **29,666 → 18,200 bytes (−38.6%)**. | same suite |
| 11.3 `RouterInputs` at the tRPC boundary (§8 MEDIUM-2) | **PARTIAL — deliberately** — `74c3e10` | `events as any` defeated the Zod contract exactly where tRPC exists to protect it. Now derived from `RouterInputs['webhook']['create']['events']`, which **immediately caught a second looseness the cast had hidden** (the checkbox handler took a bare `string`). `AVAILABLE_EVENTS` pinned with `satisfies`, so a stale option is a compile error rather than a runtime Zod failure. **Not done: the broader pass. 55 hand-written prop interfaces remain** — recorded here rather than quietly counted as complete. | same suite |

**WAVE 11 GATE: PASSED** — typecheck, lint, **102 suites / 980 tests**, build.

### WAVE 12 — Strix as a pluggable scan engine + finding→control mapping

> **Numbering.** The brief calls this "WAVE 0.5". That name is already taken:
> WAVE 0 above is itemized 0.1–0.5, and its **0.5** is the AUP + abuse runbook.
> Logging a second, unrelated "0.5" would make the two indistinguishable in a
> document whose whole job is telling an auditor which control closed when. It
> is recorded as **WAVE 12**; brief item `0.5.N` maps to `12.N` throughout.

**STEP 0 — gate check on WAVE 0 (the brief's precondition).** PASSED. All five
WAVE 0 items are DONE above with named passing tests: `VerifiedAsset` model +
migration `20260805150000_…` and `src/server/pentest/assetVerification.ts` (0.1,
`tests/assetVerification.test.ts`, 40); the SSRF blocklist, later generalized to
`src/server/lib/net/assertPublicHttpTarget.ts` by WAVE 8 (0.2,
`tests/ssrfGuard.test.ts`, 42); the `PENTEST_SCAN_AUTHORIZED` audit trail (0.3);
the anomaly signal (0.4, `tests/scanAnomaly.test.ts`, 5); the AUP (0.5). The
gate's substance — that this wave must not open a second, ungated path to a scan
— is the binding constraint on 12.1/12.2 below.

**Skills.** None of the nine named skills (`prisma-schema`, `trpc-router`,
`bullmq-setup`, `pgvector`, `graphify-rag`, `docker`, `audit-logging`,
`ui-components`, `obsidian-context`) is installed in this environment. Per the
prior-wave convention they are treated as a checklist of conventions to hold to,
stated once here.

**Brief premises corrected against the repo (STEP 0 findings, before any code).**
Same pattern as prior waves — the brief cites documents and models that this
repo does not have:

| Brief says | Repo actually has |
|---|---|
| `5_BACKEND_SCHEMA.md`, `6_IMPLEMENTATION_PLAN.md`, `4_UI_UX_DESIGN.md` | None exist. Authoritative locations: `packages/db/schema.prisma`, `Dharma-Knowledge-OS/04_TECHNICAL/Database_Design.md`, `03_PRODUCT/`, `04_TECHNICAL/Design_System.md`. |
| `AuditEvent` model | `AuditLog` (hash-chained, written via `createAuditLog`). There is no `AuditEvent`. Mappings will write `AuditLog`, i.e. the *same* surface as the nuclei path, which is what the brief actually wants. |
| Map findings against `OrganizationEmbedding where documentType = 'control'` | Controls are **not** embedded there. `Control.embedding` (`vector(384)`) is the populated column, and `packages/db/schema.prisma:376` states the convention explicitly: *"No separate embedding table: one embedding per control."* `src/server/services/controlEmbeddings.ts#suggestMappings` is the existing cosine-similarity reader. Following the brief literally would build the second embedding path the brief itself forbids — so 12.3 reuses `Control.embedding`. **Deviation, deliberate; the brief's intent (reuse) is honoured and its stated table is not.** |
| Derive CVSS "via the existing calculator" from raw output | Strix computes CVSS v3.1 itself and emits both `cvss` (float) and a `cvss_breakdown`. Plan: rebuild the vector from the breakdown and re-score it through the repo's own `src/server/pentest/cvss.ts`, so one implementation governs the number and an agent-supplied score is never trusted verbatim. |
| Strix run dir `agent_runs/<run-name>` | **`strix_runs/<run-name>`** — `strix/core/paths.py:8`, `RUNS_DIR_NAME = "strix_runs"`. The brief uses both spellings; only `strix_runs` is real. |
| Finding→control mapping is new | `src/server/pentest/autoMapVulnerabilities.ts` already exists and links findings to a control **by exact case-insensitive title match on "Vulnerability Management"** — its own header comment flags this as fragile-by-design and asks for a non-string mechanism. 12.3 is the answer to that TODO, not a greenfield feature. |

**Strix output shape — verified, not assumed.** The brief forbids faking a test
against an engine whose output shape is unverified. Docker is not running in this
environment and no Strix image is present, so a live run is impossible; instead
upstream `usestrix/strix` was cloned and read at source. Verified facts driving
the fixture and parser:
`strix_runs/<run-name>/` contains `run.json` (`run_id`, `run_name`, `status` ∈
running|completed|failed|stopped|interrupted, `start_time`, `end_time`,
`targets_info`, `scan_mode`, …), `vulnerabilities.json` (the full array),
`vulnerabilities.csv`, `vulnerabilities/<id>.md`, and
`penetration_test_report.md` (`strix/report/writer.py`, `strix/report/state.py`).
Each finding is keyed `id` (`vuln-0001`), `title`, `severity` (**lowercase**),
`timestamp`, and optionally `description`, `impact`, `target`, `endpoint`,
`method`, `cve`, `cwe`, `cvss`, `cvss_breakdown`, `technical_analysis`,
`poc_description`, `poc_script_code` (markdown-fenced), `evidence`,
`remediation_steps`, `assumptions`, `code_locations[]`, `fix_effort`,
`dependency_metadata`. **There is no `validated` boolean** — the brief assumes
one. Strix's contract is that `create_vulnerability_report` is only called for a
"fully validated path"; validation must therefore be inferred from PoC presence,
which is exactly the rule 12.2 will encode.

| Item | Status | Evidence / commit | Test |
|---|---|---|---|
| 12.1 Prisma: `ScanEngine`, `engineRunId`, required `verifiedAssetId`, `pocEvidence`, `FindingControlMapping` | IN PROGRESS | | |
| 12.2 Strix connector (compose service, `strixScanQueue`, worker w/ dispatch-time re-validation) | PENDING | | |
| 12.3 `mapFindingsToControls` via `Control.embedding` | PENDING | | |
| 12.4 tRPC: engine param, `findings.confirmMapping`, `findings.listPendingMappings`, `engines.status` | PENDING | | |
| 12.5 UI: engine selector, Findings Review Queue, PoC panel, control badge | PENDING | | |
| 12.6 Tests + WAVE 12 gate | PENDING | | |

---

## Remaining real work

1. ~~**WAVE 0.1–0.5**~~ — done (`27f3981`, `f65e661`).
2. ~~**3.4b**~~ — Organization delete cascade. Done (`fix/org-delete-cascade`).
3. **4.2b** — Cross-Walk matrix auto-population, re-assessed post-embedding-fix. **STILL OPEN.**
4. ~~**GH #20–#26**~~ — the seven open GitHub issues. Done (WAVE 9); all seven closed.

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
