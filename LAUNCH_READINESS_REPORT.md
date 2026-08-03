# Dharma — Launch-Readiness Remediation Report

**Date:** 2026-08-02
**Branch:** `Hem` (merged with `main`, clean, no conflicts)
**Scope:** the 2026-08-02 pre-launch audit findings (P0/P1/P2), per the Launch-Readiness Master Prompt v2.

---

## 1. Findings table

| ID | Finding | Status | Files changed | Test added |
|---|---|---|---|---|
| **A1** | Framework detail crashes: `An unsupported type was passed to use(): [object Object]` | **Fixed** | `src/app/dashboard/frameworks/[id]/page.tsx`, `src/app/dashboard/frameworks/[id]/readiness/page.tsx` | `tests/e2e/launch-readiness.spec.ts` — A1 |
| **A1b** | Intermittent `503 → 200` on retry | **Not reproduced** | — | — |
| **A2** | Evidence "Upload proof from a requirement" CTA deep-link | **Deferred** | — | — |
| **A3** | `Settings → Team` 404s | **Fixed** | `src/app/dashboard/settings/team/page.tsx`, `src/server/routers/organization.ts`, `src/server/routers/index.ts` | `tests/organization.router.test.ts` (10), E2E A3 |
| **A4** | `Settings → Security` 404s | **Fixed, reduced scope** | `src/app/dashboard/settings/security/page.tsx`, `src/server/routers/user.ts` | E2E A4 |
| **A5** | Pentests "Start Your First Scan" is a dead CTA | **Not a defect** — premise false | — | E2E A5 (pins behaviour) |
| **B1** | Duplicate ISO 27001 / SOC 2 framework seed data | **Fixed** | `packages/db/seed.ts` | `tests/db.test.ts` |
| **B2** | Stripe SDK loads on every route | **Fixed** | `src/app/providers.tsx`, `src/components/billing/StripeProvider.tsx` | E2E B2 |
| **B3** | All 47 routes share one `<title>` | **Fixed** | `src/app/layout.tsx`, `src/app/dashboard/layout.tsx`, +42 new `layout.tsx`, 2 inline | E2E B3 |
| **B4a** | Cross-Walk column truncation unreadable | **Fixed** | `src/components/crosswalk/MappableControlTree.tsx`, `CrossWalkPicker.tsx` | — |
| **B4b** | Cross-Walk matrix auto-population via Graphify | **Deferred** — not buildable as specified | — | — |
| **C1** | E2E/test fixtures could reach a demo build | **Fixed, wider than specified** | `src/server/testRoutes.ts`, 3 × `src/app/api/test-*/route.ts`, `envs/.env.development`, `envs/.env.test` | `tests/testRoutes.guard.test.ts` (4) |
| **C2** | 0/0 renders identically to 0/N | **Fixed (cards)** | `src/app/dashboard/frameworks/FrameworkCard.tsx` | — |

---

## 2. Deviations from the prompt, and why

### 2.1 The prompt's premises were substantially stale

Verified against the repo, not assumed:

| Prompt claim | Reality |
|---|---|
| Read `1_PRD.md`, `2_TRD.md`, `3_APP_FLOW.md`, `4_UI_UX_DESIGN.md`, `5_BACKEND_SCHEMA.md`, `6_IMPLEMENTATION_PLAN.md` | **None exist.** Zero hits repo-wide. The vault is `Dharma-Knowledge-OS/` (`03_PRODUCT/`, `04_TECHNICAL/`, …). Every Phase 1 `grep` against those filenames returns nothing. |
| Next.js 15 async `params` | **Next.js 14.2.35.** This inverts A1's root cause — see below. |
| `prisma/schema.prisma` | Schema lives at `packages/db/schema.prisma`. |
| A5: pentests empty-state CTA is dead | Already wired identically to the toolbar button. |
| B4: add `source: "auto"\|"manual"` to `ControlMapping` | Already has `suggestedByAI` + `confidenceScore`. |
| B4: create `ControlEmbedding` if missing | `prisma/seed-control-embeddings.ts` already exists; `CrossWalkPicker` already renders AI suggestions with confidence scores. |

### 2.2 A1 root cause — the opposite of hypothesis 3

Hypothesis 3 ("params is now a Promise") pointed the right direction but backwards. This app runs **Next 14**, where `params` in a client component is a plain synchronous object. Both pages typed it `Promise<{id: string}>` and unwrapped with `use()` — a Next 15 idiom — which is precisely what throws `An unsupported type was passed to use(): [object Object]`.

A previous session had already **diagnosed and documented this** in a comment at `src/app/dashboard/pentests/[id]/page.tsx:15-19` and never applied the fix.

Only two files repo-wide used `use()`; both are fixed. There is no wider instance of the pattern.

### 2.3 A1b — the `503 → 200` race did not reproduce

Six consecutive cold requests to `/dashboard/frameworks` returned 200, and the E2E A1 test passes from cold. No bounded retry was added, and no masking workaround was introduced. **If it recurs, it needs a fresh reproduction** — I will not invent a fix for a race I cannot observe.

### 2.4 A4 — most of the requested scope has no backing store

`src/server/auth.ts:137` sets `session.strategy: "jwt"`. Additionally:

- **No `Session` rows are ever written** for normal logins. The model exists only because `PrismaAdapter` declares it. There is no server-side session list to display or revoke.
- **No MFA/TOTP model exists anywhere** in `packages/db/schema.prisma`.
- **No passwords exist** — auth is Google OAuth + email magic-link only, so "change password" has no meaning here.

Per the prompt's own instruction, I did not fabricate any of it. The page ships what *is* real — account details, linked sign-in methods, org SSO-enforcement state — and **states the three gaps explicitly in the UI**. `user.listOwnSessions` / `user.revokeSession` were **not** created; there is nothing for them to return.

### 2.5 A3 — "last-active" also has no backing store

`User` has no `lastLoginAt`/`lastActiveAt` column. The roster shows **join date**, and the router returns `joinedAt`. A test asserts the response carries no `lastActiveAt`, so nobody later mistakes a placeholder for real telemetry.

Also: there is **no `Membership` join table** — `User` carries `organizationId` directly, so `listMembers` is a tenant-scoped `User` query.

### 2.6 B1 — chose option (a), with an evidence-based safety guard

`packages/db/seed.ts` `createMany`'d control-less stubs named `ISO 27001` / `SOC 2`; `scripts/seed-frameworks.ts` upserts the real frameworks as `ISO 27001:2022` / `SOC 2 Type II` from `data/frameworks/*.json`. **Different names → the upsert never matched → both rows survived.** DPDP escaped only because both files used the same name. `skipDuplicates` could not help: the rows are not duplicates under the `organizationId_name` unique key.

The cleanup guard tests **attached evidence, not control count**. Control count was too strict — these stubs pick up placeholder controls from `framework.create()`'s auto-seed, so `ISO 27001 (4 controls)` would have been stranded forever. Evidence is genuine user work a cascade would destroy, so stubs with evidence are kept and reported instead.

**Verified live:** demo org went 5 frameworks → 3 (`DPDP Act 2023`/20, `ISO 27001:2022`/24, `SOC 2 Type II`/28). Pre-fix state matched the audit exactly, including `SOC 2 (Type II, 0 controls)`.

### 2.7 B3 — 40 of 49 pages are client components

Client components **cannot export `metadata`**. Each therefore gets a small server-component `layout.tsx` (42 created, 2 inline for genuine server components). The root layout gained a `"%s | Dharma"` template.

One subtlety worth keeping: `dashboard/layout.tsx` must **restate the template**, because a nested layout setting a plain-string title replaces the parent template for its whole subtree — which silently stripped `| Dharma` from every page under `/dashboard` on the first attempt.

**Two routes still fall back to the default title** (`/onboarding`, `/audit/portal`): their existing `layout.tsx` files are client components, so metadata cannot be added without restructuring. Flagged, not silently skipped.

### 2.8 C1 — the real risk was larger than the prompt described

The prompt asked for a `SEED_ENV=test` guard on seed scripts. The actual E2E artifacts come from **`/api/test-*` routes**, which were already guarded — but **allow-by-default**:

```ts
if (process.env.NODE_ENV === "production" && process.env.ENABLE_E2E_AUTH !== "true")
```

`/api/test-auth?email=<anyone>` mints a valid session for an arbitrary user. Because the check only fires in production, **any non-production deployment — staging, a demo box, a docker run left at `NODE_ENV=development` — exposed a complete authentication bypass to anyone who could reach the URL.**

Worse: **`envs/.env.docker:77` already sets `ENABLE_E2E_AUTH=true`**, so the docker profile — the one you would demo from — opted into the bypass explicitly.

Replaced with deny-by-default in `src/server/testRoutes.ts`: off unless `ENABLE_E2E_AUTH=true`, regardless of `NODE_ENV`.

> **Action required before any demo or production deploy: remove `ENABLE_E2E_AUTH=true` from `envs/.env.docker`.** I did not change that file — it would have broken the docker E2E profile that currently depends on it, and that trade-off is yours to make.

### 2.9 B4b — deferred because the specified tooling does not exist

See the tool log below: `graphify extract` and `graphify link --threshold` are not real commands. Graphify has **no semantic-linking capability at all**. Building this properly means computing cosine similarity over the existing pgvector embeddings directly and adding a `crosswalk-mapping` BullMQ queue — a multi-hour build on a half-existing schema, which you scoped out of this sprint. The readability half is done.

### 2.10 Orchestration

Executed **sequentially, by me** — not via a ruflo swarm. This is the fallback your prompt explicitly permits, chosen because the remaining work was small enough that orchestration overhead exceeded its benefit (ruflo's own skill doc advises against it for work a single agent can complete). Stated here rather than silently skipped.

---

## 3. Tool-usage log

| Tool | Status | Commands actually run | What it surfaced |
|---|---|---|---|
| **code-review-graph** | ✅ Used | `code-review-graph status`, `code-review-graph update`, `code-review-graph detect-changes` | Graph was stale (built 2026-07-23 @ `9d28729`). After update: 8 files changed, 25 nodes, 163 edges; risk 0.50; **7 test gaps**, untested: the 3 `/api/test-*` `GET` handlers, `CrossWalkPicker`, `MappableControlTree`. |
| | ⚠️ **Prompt syntax wrong** | `analyze <path> --depth 2`, `--pattern "empty-state-handlers"` | **No `analyze` subcommand exists.** Real: `install, init, build, update, postprocess, watch, status, visualize, wiki, register, unregister, repos, eval, detect-changes, serve`. No `--depth` or `--pattern` flags. Fell back to the manual grep sweep as your prompt instructed. |
| **graphify** | ✅ Present, ❌ not applicable | `graphify --help` | Real commands: `install, uninstall, path, explain, diagnose, clone, merge-driver, merge-graphs, add, watch, update, cluster-only`. **`extract` and `link --threshold` do not exist**; Graphify performs no semantic similarity linking. B4b deferred on this basis. |
| **ruflo** | ✅ Available, not used | `npx ruflo --version` (failed), `npx claude-flow@alpha --version` → `ruflo v3.34.0`, `--help`, `daemon stop` | `npx ruflo` fails with a corrupted npx cache (`ENOTEMPTY` on `agentdb`); the working entry point is `npx claude-flow@alpha`. Real subcommands: `init, start, status, agent, swarm, memory, task, session, mcp, hooks, hive-mind, autopilot` — not `agent add --serial --tasks`. Sequential execution chosen (§2.10). Note: `--help` **starts a background daemon**; stopped it. |
| **gstack** | ✅ Present, not applicable | Read `.agents/skills/gstack/SKILL.md` | It is a **router skill** (routes to planning/review/QA/security skills), not a scaffolder. `gstack scaffold page --name team` is not a real command. New files were matched by hand to the existing Roles page instead. |
| **awesome-copilot** | ✅ Present, ⚠️ empty for this purpose | `ls ~/.copilot/installed-plugins/awesome-copilot` | Contains only `security-best-practices/` and `software-engineering-team/`. **No `patterns/` directory**, so no tRPC reference patterns to grep. Conventions taken from `src/server/routers/roles.ts` instead. |
| **obsidian-context** | ❌ **NOT AVAILABLE** | `find` for all six named docs | **None of the six documents exist.** Behavioural intent was derived from the code and `Dharma-Knowledge-OS/` instead. |

---

## 4. Newly discovered issues (not in the original audit)

1. **`/api/test-auth` auth bypass on non-production deployments** — §2.8. The most serious finding of this sprint. **Fixed**, plus an outstanding action on `envs/.env.docker`.
2. **Broken `PostToolUse` hook** — your hook runs `code-review-graph update --quiet --skip-flows`; `--quiet` is not a valid flag, so it errored on *every* tool call this session. Fix: drop the flags, use `code-review-graph update`. **Not fixed** (your config, outside repo scope).
3. **Jest never exits** — importing `appRouter` opens BullMQ/ioredis handles that are never closed, so `npm run test` hangs indefinitely after tests finish. This is why a run appeared to "hang" for 15 minutes at 0 CPU. Workaround: `--forceExit`. **Not fixed** — the real fix is closing queue connections in a global teardown, which touches queue lifecycle beyond this sprint's scope.
4. **E2E specs are flaky under `fullyParallel`** — concurrent hits on `/api/test-auth` race and the redirect to `/dashboard` intermittently never lands (4/6 failures in parallel, 0/6 serial). My spec is pinned to `mode: "serial"`; **the pre-existing specs are not** and are likely intermittently flaky in CI.
5. **Shared test DB accumulates rows between runs** — `endpoint.integration.test.ts` fails with 2 identical evidence rows where it expects 1. It passes at the pre-sprint commit and fails after repeated runs on the same DB. Not a code regression; the suite lacks per-run isolation.
6. **`ISO 27001` stub carried 4 auto-seeded controls** — drove the evidence-based guard design in §2.6.
7. **`StripeProvider` provided context nothing consumed** — no `useStripe`/`useElements`/`CardElement` exists anywhere in the codebase, so the app-wide mount was pure cost.
8. **Last-admin guard is unreachable via legacy roles** — only `ADMIN` holds `members.invite`, and an admin removing the sole admin is caught earlier by the self-removal guard. The guard is still correct defence-in-depth for **custom roles**, which is how the test exercises it.

---

## 5. Test output

### tRPC router tests — new

```
tests/organization.router.test.ts
  ✓ returns only members of the caller's organization (14 ms)
  ✓ reports pagination metadata (1 ms)
  ✓ exposes joinedAt rather than a fabricated last-active value (1 ms)
  ✓ updates the role of a member in the caller's org (9 ms)
  ✓ refuses to change a member in another organization (4 ms)
  ✓ refuses to let a caller change their own role (1 ms)
  ✓ refuses to remove a member in another organization (2 ms)
  ✓ refuses to let a caller remove themselves
  ✓ soft-deletes the member so audit attribution survives (5 ms)
  ✓ refuses to remove the last remaining admin (4 ms)
Tests:       10 passed, 10 total
```

```
tests/testRoutes.guard.test.ts
  ✓ allows the route when explicitly opted in
  ✓ blocks when the flag is unset
  ✓ blocks when the flag is any value other than 'true'
  ✓ blocks in a non-production environment when not opted in
Tests:       4 passed, 4 total
```

### E2E — new (post-merge)

```
Running 6 tests using 1 worker
  ✓  1 A1: framework detail pages render controls instead of crashing (7.0s)
  ✓  2 A3: settings Team page loads and lists members (3.4s)
  ✓  3 A4: settings Security page loads and states its capability gaps (2.4s)
  ✓  4 A5: pentests empty-state CTA opens the same modal as the toolbar button (2.6s)
  ✓  5 B3: routes have distinct, descriptive titles (6.1s)
  ✓  6 B2: Stripe SDK does not load outside billing (2.5s)
  6 passed (24.5s)
```

### Full jest suite (post-merge)

```
FAIL tests/endpoint.integration.test.ts
FAIL tests/framework.test.ts
Test Suites: 2 failed, 75 passed, 77 total
Tests:       10 failed, 555 passed, 565 total
```

**All 10 failures are pre-existing or environmental — none are regressions.** Verified by checking out the pre-sprint commit `125799c` and re-running:

- `tests/framework.test.ts` — **8 failures at `125799c` too.** Control auto-seeding; untouched by this sprint.
- `tests/endpoint.integration.test.ts` — passed at `125799c` on a clean DB; fails now from accumulated rows (§4.5). 9 failures in isolation vs 10 in the full run — the extra one appears only under full-suite accumulation, which corroborates the diagnosis.

`tests/db.test.ts` **was** failing because of my change (its assertion still expected the removed `framework.createMany`); it has been updated to assert the new behaviour and now passes.

`npx tsc --noEmit` is clean.

---

## 6. Deployment-readiness checklist — actual status

| # | Item | Status |
|---|---|---|
| 1 | Clean `docker compose up --build`, all services healthy | **Not run.** Verified against the already-running stack (postgres/redis/minio/worker/pentest-worker healthy) + `npm run dev`. A from-scratch volume-less rebuild was not performed. |
| 2 | Seed clean DB, zero E2E artifacts | **Partially.** `npm run db:seed` verified (5 → 3 frameworks). Not re-run against a fresh volume. |
| 3 | Full click-through of every module + all 13 settings tabs | **Not done.** Automated coverage exists for the 6 flows above; the exhaustive manual PASS/FAIL matrix was not produced. |
| 4 | `AuditEvent` written for every mutation touched | **By construction, not observed.** New mutations call `emitAuditEvent`; not verified by inspecting rows. |
| 5 | Second-org tenant-isolation check | **Done at the router layer** — `tests/organization.router.test.ts` creates a real second org and asserts read + both mutations refuse cross-org access. Not repeated via HTTP. |
| 6 | Perf check confirming Stripe gone outside billing | **Done** via E2E network assertion (0 requests to `js.stripe.com` across 3 routes). No Lighthouse run. |
| 7 | Distinct `<title>` per route | **Done**, except the 2 routes in §2.7. |

---

## 7. Remaining gaps — explicitly out of scope

1. **A2** — Evidence CTA deep-linking to a specific framework/control. Not started.
2. **B4b** — Cross-Walk semantic auto-population (§2.9).
3. **`envs/.env.docker` still sets `ENABLE_E2E_AUTH=true`** — must be removed before any demo/production deploy (§2.8).
4. **Jest hangs without `--forceExit`** (§4.3).
5. **Pre-existing E2E flakiness under `fullyParallel`** (§4.4) and **test-DB isolation** (§4.5).
6. **8 pre-existing `framework.test.ts` failures** around control auto-seeding.
7. **`/onboarding` and `/audit/portal` lack distinct titles** (§2.7).
8. **C2 applied to framework cards only** — the dashboard rollup was not audited for the same 0/0 vs 0/N conflation.
9. **Real connector integrations** (Google Workspace / AWS / GitHub) — Weeks 9–16 per the audit's own plan.
10. **`framework.getById` explicit Zod output schema** — not added; A1's root cause was the `use()` misuse, not the payload shape, so this would have been ceremony rather than a fix.
