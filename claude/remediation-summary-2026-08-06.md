# Remediation summary — `claude/fullstack-audit-2026-08-06.md`

**Date:** 2026-08-06 · **Branch:** `main` · **Base:** `8c60469` → **HEAD:** `431e35a`

**Ground rule held throughout:** nothing is marked DONE without a passing test
attached, and for every CRITICAL/HIGH item the test was verified to **fail on
the pre-fix code** by reverting the specific file(s) and re-running.

**Harness movement:** baseline **90 suites / 736 tests** → **95 suites / 835
tests**, all green. `tsc --noEmit` clean, lint clean (the same 6 pre-existing
warnings, all in files this pass did not touch), `npm run build` succeeds.

---

## 1. Status at a glance

| Wave | Scope | Status |
|---|---|---|
| Precondition | Uncommitted infra tree (DEV-3, DEV-10) | ✅ DONE |
| **WAVE 5** | Session revocation + marketplace authorization | ✅ DONE |
| **WAVE 6** | Kubernetes/Helm parity | ⚠️ **PARTIAL** — 6.2, 6.3 DONE; **6.1 BLOCKED** |
| **WAVE 8** | SSRF guard generalization | ✅ DONE |
| **WAVE 10** | Observability & infra validation | ⚠️ **PARTIAL** — 10.3, 10.4, 10.5 DONE; 10.1, 10.2, 10.6 **NOT STARTED** |
| **WAVE 7** | Policies lifecycle | ❌ **NOT STARTED** |
| **WAVE 9** | RBAC retrofit, UI state sweep, focus trap | ❌ **NOT STARTED** |
| **WAVE 11** | Scoring semantics, code-split, `RouterOutputs` | ❌ **NOT STARTED** |

**This pass is incomplete.** Waves 5, 6, 8 and part of 10 were executed to the
full loop protocol. Waves 7, 9, 11 and the rest of 10 were **not started** — I
ran out of working context before reaching them. They are listed in §5 with
everything a next session needs. Nothing was left half-edited: the working tree
is clean and every commit is self-contained and gated.

---

## 2. Item-by-item

| # | Item | Status | Commit | Proving test |
|---|---|---|---|---|
| — | Commit the Helm-authoritative deploy tree (DEV-3, DEV-10) | DONE | `ff8e091` | n/a (infra; each diff reviewed individually, not `git add -A`) |
| — | Run the never-executed scan-anomaly suite (fix-log 0.4 caveat) | DONE | `45765c2` | `tests/scanAnomaly.test.ts` (5) — 5/5 green |
| **5.1** | Re-read the user row in `orgProcedure` (BE-1) | DONE | `c27d964` | `tests/sessionRevocation.test.ts` (8) — **6 fail pre-fix** |
| **5.2** | Marketplace hardening (BE-2/5/6/7/8) + 7 orphaned routes (§4 HIGH-1, MEDIUM-1) | DONE | `5bfeb67` | `tests/marketplace.router.test.ts` (16) — **12 fail pre-fix**; `import.router.test.ts` (4); `navCapabilities.test.ts` (9); 4 new breadcrumb cases |
| **6.1** | Pentest worker on Helm (ARCH-1) | **BLOCKED** — gap made explicit | `72431e6` | `tests/helmChart.test.ts` — 5 guard cases incl. "never mounts the host Docker socket" |
| **6.2** | `prisma migrate deploy` pre-upgrade hook (DEV-1) | DONE | `72431e6` | `tests/helmChart.test.ts` — hook annotations, command, no-retry, both real values files |
| **6.3** | `deploy.yml` verify step + smoke host (DEV-2) | DONE | `72431e6` | `tests/helmChart.test.ts` "deployment naming" |
| **8.1–8.3** | `assertPublicHttpTarget` + all 5 call sites + redirects (BE-4) | DONE | `431e35a` | `tests/ssrfGuard.test.ts` (42) — static no-bare-`fetch` check **verified to fail on a reverted call site** |
| **10.3** | `notify` job dependency graph (DEV-7) | DONE | `72431e6` | Workflow parsed and `needs`/`if` asserted |
| **10.4** | `infra-validate` templates the real values files; `kubeconform` on `k8s/` (DEV-5) | DONE | `72431e6` | CI job; `helm lint` verified locally against all three values files |
| **10.5** | `CHANGE_ME` in the production secret guard (DEV-6) | DONE | `72431e6` | `tests/envInsecureDefaults.test.ts` (8) — **3 fail pre-fix** |

---

## 3. VERIFIED vs. ASSUMED — no silent upgrades

The audit's ASSUMED items were **not** promoted without actually checking.

| Audit item | Was | Now | Why |
|---|---|---|---|
| `LimitRange` (cpu 2 / mem 4Gi) vs. the Ollama Pod (Compose grants 8GB) — §5 | ASSUMED | **STILL ASSUMED** | Needs `kubectl --dry-run=server` against a live cluster. **No cluster is available in this environment**: `helm` and `kubectl` are installed, but there is no kind/k3d/minikube and `kubectl config current-context` is unset. Not checked, so not claimed. |
| k8s manifests actually admit (`--dry-run=server`) | ASSUMED | **PARTIALLY ADDRESSED, still ASSUMED for admission** | CI now runs `kubeconform -strict` over `k8s/*.yaml` (10.4), which is schema validation without a cluster. That catches apiVersion/unknown-field errors but **does not run admission control**, so genuine server-side admission remains unverified. |
| Helm chart rendering | ASSUMED | **VERIFIED (client-side only)** | `helm lint` + `helm template` pass against `values.yaml`, `values-staging.yaml` and `values-production.yaml`, and the pentest guard matrix behaves correctly. This is **rendering**, not deployment — no `helm install` was run. |
| Connector adapter coverage (`AZURE`/`GCP` null) | ASSUMED (from the vault) | **STILL ASSUMED** | Not re-read from `connectorRegistry` this pass; out of scope for the waves executed. |
| Billing sign-off | Unverified | **STILL UNVERIFIED** | No live Razorpay test-mode cycle run. Nothing found contradicts it. |
| DNS-rebind simulation for WAVE 8 | — | **NOT PERFORMED** | Needs a domain whose resolution can be changed between check and fetch. Re-resolution is asserted structurally instead. Same blocker as WAVE 0.1's DNS challenge. |

I also **corrected one audit claim rather than coding to it**: DEV-6 states that
`helm install` at defaults boots with `NEXTAUTH_SECRET=CHANGE_ME`. Bare
`CHANGE_ME` (9 chars) was in fact **already** refused by the schema's existing
`min(32)` rule. The real exposure was the *URL-embedded* and MinIO placeholders,
which is what the fix and its test target. My first draft of that test passed
for the wrong reason (a ZodError also names the variable); it now asserts the
guard's own message.

---

## 4. BLOCKED — what I need from you

### 4.1 WAVE 6.1 — pentest scanning on Kubernetes (ARCH-1)

**State:** the silent gap is closed; the *capability* is not built.

Previously, a Helm-deployed Dharma accepted scans that then sat in Redis forever
with no consumer, no error and no UI signal. The chart now **fails at template
time** unless the operator states where scans run. An install that refuses is a
far better failure than a queue that swallows every scan.

I deliberately did **not** close this by mounting `/var/run/docker.sock` into a
Pod. On Compose's single host that socket grants root on a host the operator
already owns; in a shared cluster it grants root on a node running other
tenants' workloads. That would have been a silent **downgrade** of the isolation
`Security_Architecture.md` assumes, dressed up as parity.

**To unblock, I need two things:**

1. **A live Kubernetes cluster** (or approval to provision a local kind/k3d) to
   validate a per-scan Job runner against. Writing it blind and calling it done
   would break this pass's one non-negotiable rule.
2. **A decision on isolation approach** — per-scan Kubernetes Job with a scoped
   ServiceAccount, *or* a sandboxed runtime (gVisor/Kata), *or* a dedicated node
   pool with PodSecurity restrictions. `src/server/pentest/scanner.ts` shells out
   to `docker run`/`docker network create` and needs rewriting for whichever you
   pick. My recommendation is the per-scan Job with a scoped ServiceAccount: it
   needs no special runtime or node pool, and it is the only option that keeps
   the blast radius per-scan the way Compose's separate container does.

### 4.2 WAVE 11.1 — the `Control.status` product decision (not reached)

Not started, and flagging it explicitly because the brief asked me to state who
decided. **Nobody has decided, including me** — I did not reach WAVE 11, so I
have not defaulted to option (b) or implemented anything. The disconnect stands
exactly as the audit describes: `readinessScoring.ts` never reads
`Control.status`, so marking every control COMPLIANT leaves the score at 0%.
This is a product call about what the number means, and it is still yours to
make.

### 4.3 Standing blockers (carried forward, not from this pass)

- **A controllable test domain** — blocks both WAVE 0.1's DNS-challenge E2E and
  WAVE 8's DNS-rebind simulation.
- **Billing sign-off** — a live Razorpay test-mode cycle.

---

## 5. Not started — for the next session

Ordered as I would take them. Each is independent of the others.

| Wave | Item | Note |
|---|---|---|
| **7** | Policies lifecycle — `policy.getById/update/publish/delete`, `policies/[id]/page.tsx`, link the list cards, CTA on the empty state | The audit's other CRITICAL. The headline "AI policy generation" feature still produces documents that can never be opened, edited, published or deleted. **Highest remaining priority.** |
| **9.1** | RBAC retrofit — `permissionProcedure` on the remaining 25 routers, **or** remove the 13 unenforced keys from the Roles UI | WAVE 5.1 did the groundwork: `ctx.identity` is already resolved and cached, so a retrofit now costs no extra query. Note the UI currently sells a control the backend does not have. |
| **9.2** | `isError`/retry sweep, `/dashboard` first | A Postgres outage currently renders as "0 frameworks, 0% ready" — actively misleading for a compliance product, not just missing polish. |
| **9.3–9.5** | Dialog focus trap + `aria-labelledby`; migrate 2 `window.confirm` sites; `empty-state.tsx` adoption | `dialog.tsx` comments claim a focus trap it does not implement, across all 6 modals. |
| **10.1** | `monitoring/rules/` + wire Alertmanager or `OPS_ALERT_WEBHOOK_URL` | `rule_files` points at a directory that does not exist; Prometheus loads zero rules **silently**. Postgres down, Redis down and queue backlog currently alert nobody. |
| **10.2** | `auth_attempts_total` Grafana panel | Metric is already instrumented; only the panel is missing. Cheap. |
| **10.6** | Scheduled restore smoke test in CI | Backups are restore-drilled but only as of one manual run. |
| **11.1** | `Control.status` vs. readiness score | See §4.2 — needs your decision first. |
| **11.2–11.3** | `next/dynamic` the Advisor panel; adopt `RouterOutputs` | Housekeeping. Note `settings/webhooks/page.tsx`'s `events as any` cast defeats the Zod contract at the tRPC boundary. |

---

## 6. Notable things found along the way

Recorded because each changed what I built, and a later session should not
rediscover them.

1. **I introduced a regression and the gate caught it.** Caching the joined
   `CustomRole` in WAVE 5.1's identity cache broke Phase 8's explicit
   "permission changes take effect immediately (no session-cached bypass)"
   guarantee — editing a role is not a `User` write, so the cache went stale.
   Fixed by caching **User scalars only** and reading `CustomRole` fresh. This is
   why 5.1's cache holds `customRoleId` and not the permission map.

2. **Two test suites were passing for the wrong reason, throughout the entire
   window their vulnerability was open.** `marketplace.router.test.ts` asserted
   "publishItem calls service with auth ctx" while the router had *no*
   authorization check, and `import.router.test.ts` passed a context with no
   prisma client at all. Both were rewritten against the real database. A
   mock-only test of an authorization path is worse than no test — it reports
   safety it never checked.

3. **16 tests across 9 suites asserted a role only in the session** while the
   seeded row said ADMIN. That is precisely the escalation BE-1 describes, so
   after 5.1 it is no longer a way to hold a role. Corrected via one shared
   `tests/fixtures/seedRoleUser.ts` rather than six copies.

4. **`prisma migrate diff` caught a schema/migration divergence of mine** — I
   wrote a *partial* index in SQL that Prisma cannot express in the schema, so
   the two would never have matched. Resolved by dropping the index (the only
   access path is `findUnique` by id). Two **pre-existing** drifts remain and are
   not from this pass — the `vector` extension and a removed `Control.path`
   index — confirmed identical at HEAD.

5. **`/dashboard/admin`, `/dashboard/publisher` and `/dashboard/controls`** are
   grouping segments with no `page.tsx`, and breadcrumbs linked all three —
   prefetching a 404. Same defect `afe724f` fixed for `settings/enterprise`,
   found by checking *every* segment rather than only the reported one.

6. **The data containers stopped mid-pass** (Postgres/Redis/MinIO). Restarted
   via compose; unrelated to any change here, but worth knowing if a suite
   suddenly reports `Can't reach database server`.
