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
| 0.4 Distinct-asset anomaly signal | **DONE** | `src/server/pentest/scanAnomaly.ts` — Redis SET of distinct targets per org on a sliding 1h window, threshold 15. Advisory only: emits `PENTEST_SCAN_SPREAD_ANOMALY` to the audit log, never blocks, and returns null (no signal) if Redis is down. | Covered indirectly; the create path exercises it in `pentest.router.test.ts`. **Gap: no dedicated unit test** — see below. |
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
| 2.1 Session revocation | ALREADY DONE (scoped, documented) | Report §2.4 — auth is `strategy: "jwt"`, no `Session` rows are ever written, no MFA model, no passwords (Google OAuth + magic link only). The page ships what is real and states the gaps. `b24726c` additionally resolved "session expires" from the cookie's own `exp` claim. |
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
- **WAVE 0.4 has no dedicated unit test** — `recordScanTarget` is exercised only
  incidentally through the create path. The threshold/sliding-window behaviour
  itself is unverified.
- **Jest does not exit on its own** (82 open handles from module-scope BullMQ
  `new Queue(...)` across 11 queue files). Pre-existing and already compensated:
  CI runs `npm test -- --forceExit`, documented at `.github/workflows/deploy.yml:130`.
  A real fix means lazy queue initialization across those 11 modules.

## Progress

- [x] STEP 0 context load + item-by-item verification (this document).
- [x] WAVE 0.
- [x] 3.4b — Organization delete cascade.
- [ ] 4.2b — Cross-Walk matrix auto-population.
