# Dharma — Integration Report

**Date:** 2026-07-15
**Branch:** `Hem` @ `801bfeb` (pushed to `origin/Hem`)
**Scope:** Static + test-suite integration verification of the Phase 9 work
(endpoint agent, advanced reporting, regulatory monitoring, public API) against
the existing Phase 0–8 codebase.

> **Method note.** The master integration prompt was written against an assumed
> layout (`prisma/schema.prisma`, `src/server/api/routers`, `pnpm`, an
> `AuditEvent` model). This repo actually uses `packages/db/schema.prisma`,
> `src/server/routers/`, `npm`, and `AuditLog`. All checks below were run
> against the **real** repo, not the prompt's assumed paths.

---

## 1. Summary

**Status: Ready with known gaps.**

The codebase integrates cleanly at the static and unit/integration level:
`tsc --noEmit` passes with zero errors across the whole tree, all 30 tRPC
routers are registered, every backend-schema model exists with a matching
migration, and 486/489 tests pass. The 3 failing tests are a **pre-existing**
mock defect in a Phase 0/1 suite — not a Phase 9 regression (proven by running
the same suite on the parent commit).

The "gaps" are verification gaps, not known bugs: live-infrastructure journeys
(Docker boot, Stripe webhooks, AWS connector sync, SAML IdP, BullMQ job
execution, Playwright E2E) were **not** exercised in this environment and are
listed honestly as unverified rather than asserted as passing.

---

## 2. Cleanup Log

**No files were deleted — none warranted it.**

Detection passes run:
- Suspicious names (`*copy*`, `*old*`, `*backup*`, `*.bak`, `*-v2*`, `*temp*`):
  only false positives (`promptTemplates.ts`, `iamPolicyTemplate.ts`,
  `ControlDetailModal.tsx` — legitimate files matching substrings).
- Duplicate basenames: only standard Next.js conventions (`page.tsx`,
  `route.ts`, `layout.tsx`, `index.ts`) in distinct directories.
- Orphaned routers: none — all 30 router files in `src/server/routers/` are
  imported into `appRouter`.

Iterative phase-by-phase development did **not** leave dead/duplicate code
debris in this repo. (Doc-level duplication does exist in the Obsidian vault —
`1_PRD.md` vs `PRD.md`, `2_TRD.md` vs `TRD.md`, etc. — but that is
documentation, out of scope for code cleanup.)

---

## 3. Bugs Found & Fixed

None fixed in this pass. One pre-existing defect was **identified** (see §4).
Phase 9 itself introduced no bugs detectable by typecheck or the test suite.

---

## 4. Known Gaps

### 4a. Pre-existing test failure (NOT Phase 9)
`tests/onboarding-router.test.ts` — 3 failures:
- `should setup organization`
- `should select frameworks`
- `should complete onboarding`

**Root cause:** `TypeError: prismaClient.$transaction is not a function` at
`src/server/audit-log.ts:50`. The Phase 8 append-only audit change made
`createAuditLog` wrap its writes in `prisma.$transaction(...)`; the onboarding
test's Prisma mock predates that and does not stub `$transaction`.

**Proven pre-existing:** the identical 3 failures reproduce on parent commit
`a5913e1` ("test(phase8): … all passing"). Phase 9 touched neither
`onboarding.ts` nor `audit-log.ts`. Fix is to extend the test mock to implement
`$transaction` (pass a `tx` proxy through to the mocked delegates) — a
test-only change, no source change needed.

### 4b. Tenant-isolation coverage is Phase 8-scoped
`tests/phase8-tenant-isolation.test.ts` asserts cross-org isolation for SSO,
SCIM, custom roles, audit chains, white-label, and MSSP. It does **not** contain
dedicated negative tests for Phase 9 tables (`Endpoint`, `EndpointCheck`,
`Report`, `ReportSchedule`, `RegulatoryAlert`, `ApiKey`) or the connector /
vulnerability / embedding tables. Those routers do scope by org via
`orgProcedure`, but there is no dedicated cross-phase negative regression test.
Recommend adding one before GA.

### 4c. Unverified live-infrastructure journeys
Not exercisable in this environment; must be validated by a human before
production:
- Docker full-stack boot (`docker compose up`) with no crash-looping containers
- Stripe checkout → webhook → `Organization.planId` update round-trip
- AWS connector ARN/external-id validation and real evidence sync
- Pentest scan against a sandboxed nuclei target
- SAML IdP callback + SSO-only login enforcement
- BullMQ workers actually draining jobs against Redis (workers are registered
  in `src/workers/index.ts`; execution not observed here)
- Playwright E2E specs under `tests/e2e/`

---

## 5. Test Results

| Suite dimension | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ 0 errors |
| Test Suites | 71 passed, 1 failed, **72 total** |
| Tests | 486 passed, 3 failed, **489 total** |
| Failing suite | `tests/onboarding-router.test.ts` (pre-existing, §4a) |
| Phase 9 regressions | **0** |

Note: after printing the summary, jest reports "did not exit one second after
the test run" — open Redis/Prisma handles are not torn down in `afterAll`. A
housekeeping item (add teardown / `--forceExit`), not a correctness failure.

---

## 6. Integration Verification Detail (what WAS proven)

- **Schema completeness** — every model named in `5_BACKEND_SCHEMA.md` exists in
  `packages/db/schema.prisma` (`AuditEvent` is realized as `AuditLog`): `Plan`,
  `MarketplaceItem`, `ImportedItem`, `Connector`, `EvidenceMapping`, `PenTest`,
  `Vulnerability`, `ControlMapping`, `AIAdvisorSession`, `OrganizationEmbedding`,
  `OrganizationSettings`, `OrganizationGroup`, plus Phase 9's `Endpoint`,
  `EndpointCheck`, `Report`, `ReportSchedule`, `RegulatoryAlert`,
  `FrameworkVersion`, `ApiKey`.
- **Migration alignment** — Phase 9 migrations
  (`20260715120000_*`, `_130000_*`, `_140000_*`) create the matching tables.
- **Router wiring** — all 30 routers registered in
  `src/server/routers/index.ts`; no orphans.
- **UI ↔ API integration (app-wide, static proof)** — because the tRPC client
  is fully typed, a zero-error `tsc` proves every `api.<router>.<proc>` call site
  resolves to a real procedure. Spot-checked Phase 9 pages (endpoints, reports,
  regulatory-alerts, api-keys) explicitly — all calls resolve.
- **Worker registration** — Phase 4/5/7/8/9 workers all wired and drained on
  SIGTERM in `src/workers/index.ts`.

---

## 7. Follow-up Recommendations

1. **Fix the onboarding test mock** (§4a) to restore a green suite — low-risk,
   test-only.
2. **Add cross-phase tenant-isolation tests** (§4b) covering Phase 9 tables.
3. **Add jest teardown** for Redis/Prisma to remove the "did not exit" warning.
4. **Run the live-infrastructure journeys** (§4c) in a staging environment
   before GA — none of them were validated here.
5. Consider correcting the parent commit's "all passing" claim in project notes;
   the onboarding suite was already red at `a5913e1`.
