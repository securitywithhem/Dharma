# Remediation summary — `claude/fullstack-audit-2026-08-06.md`

**Date:** 2026-08-06 → 2026-08-07 · **Branch:** `main` · **Base:** `8c60469` → **HEAD:** `74c3e10`

**Ground rule held throughout:** nothing is marked DONE without a passing test
attached, and for every CRITICAL/HIGH item the test was verified to **fail on
the pre-fix code** by reverting the specific file(s) and re-running.

**Harness movement:** baseline **90 suites / 736 tests** → **102 suites / 980
tests**, all green. `tsc --noEmit` clean, lint clean (the same 6 pre-existing
warnings, all in files this pass did not touch), `npm run build` succeeds.

---

## 1. Status at a glance

| Wave | Scope | Status |
|---|---|---|
| Precondition | Uncommitted infra tree (DEV-3, DEV-10) | ✅ DONE |
| **WAVE 5** | Session revocation + marketplace authorization | ✅ DONE |
| **WAVE 6** | Kubernetes/Helm parity | ⚠️ 6.2, 6.3 DONE; **6.1 BLOCKED** (gap made explicit) |
| **WAVE 7** | Policies lifecycle | ✅ DONE |
| **WAVE 8** | SSRF guard generalization | ✅ DONE |
| **WAVE 9** | RBAC retrofit, focus trap, confirm/error-state sweep | ✅ DONE |
| **WAVE 10** | Observability & infra validation | ✅ DONE |
| **WAVE 11** | Scoring semantics, code-split, tRPC contract | ✅ DONE (11.3 deliberately partial) |

**Every wave in the brief is now closed except WAVE 6.1**, which is blocked on
inputs only you can supply (§4.1), and WAVE 11.3's broader `RouterOutputs`
pass, which is explicitly partial (§5).

---

## 2. Item-by-item

| # | Item | Status | Commit | Proving test |
|---|---|---|---|---|
| — | Commit the Helm-authoritative deploy tree (DEV-3, DEV-10) | DONE | `ff8e091` | n/a — each diff reviewed individually, not `git add -A` |
| — | Run the never-executed scan-anomaly suite (fix-log 0.4) | DONE | `45765c2` | `scanAnomaly.test.ts` (5) |
| **5.1** | Re-read the user row in `orgProcedure` (BE-1) | DONE | `c27d964` | `sessionRevocation.test.ts` (8) — **6 fail pre-fix** |
| **5.2** | Marketplace hardening (BE-2/5/6/7/8) + 7 orphaned routes | DONE | `5bfeb67` | `marketplace.router.test.ts` (16) — **12 fail pre-fix**; + `import.router` (4), `navCapabilities` (9), 4 breadcrumb cases |
| **6.1** | Pentest worker on Helm (ARCH-1) | **BLOCKED** — gap made explicit | `72431e6` | `helmChart.test.ts` — 5 guard cases incl. "never mounts the host Docker socket" |
| **6.2** | `prisma migrate deploy` pre-upgrade hook (DEV-1) | DONE | `72431e6` | `helmChart.test.ts` — hook annotations, command, no-retry, both real values files |
| **6.3** | `deploy.yml` verify step + smoke host (DEV-2) | DONE | `72431e6` | `helmChart.test.ts` "deployment naming" |
| **7.1** | `policy.getById/update/publish/unpublish/delete` + schema | DONE | `51a9568` | `policy.lifecycle.test.ts` (22) — **whole suite fails to compile pre-fix** |
| **7.2** | `policies/[id]` detail/review page | DONE | `51a9568` | E2E + `policies.page.test.tsx` |
| **7.3** | List page: links, three-way state, empty-state CTA | DONE | `51a9568` | `policies.page.test.tsx` (9) — **6 fail pre-fix** |
| **7.4** | E2E through the real journey | DONE | `51a9568` | `e2e/policy.spec.ts` (2 new) |
| **8.1–8.3** | `assertPublicHttpTarget` + all 5 call sites + redirects (BE-4) | DONE | `431e35a` | `ssrfGuard.test.ts` (42) — static no-bare-`fetch` check **verified to fail on a reverted call site** |
| **9.1** | RBAC retrofit — 6 routers → 19 (BE-3) | DONE | `5a11909` | `rbac.retrofit.test.ts` (43) |
| **9.2/9.5** | Error-state sweep + shared `QueryError` (§6 HIGH-1) | DONE | `b98a4af` | `errorStateCoverage.test.ts` (25) |
| **9.3** | Dialog focus trap + `aria-labelledby` (§6 MEDIUM-1) | DONE | `e5f1e69` | `dialog.focusTrap.test.tsx` (11) — **10 of 11 fail pre-fix** |
| **9.4** | `window.confirm` migration (§6 MEDIUM-2) | DONE | `e5f1e69` | zero-native-confirm assertion, app-wide |
| **10.1** | Prometheus rules + one alerting path (DEV-4) | DONE | `8d7a8f7` | `monitoringRules.test.ts` (18); `promtool`/`amtool` both SUCCESS |
| **10.2** | `auth_attempts_total` Grafana panel (DEV-8) | DONE | `8d7a8f7` | same suite |
| **10.3** | `notify` job dependency graph (DEV-7) | DONE | `72431e6` | workflow parsed, `needs`/`if` asserted |
| **10.4** | `infra-validate` real values files + `kubeconform` (DEV-5) | DONE | `72431e6` | CI job |
| **10.5** | `CHANGE_ME` in the secret guard (DEV-6) | DONE | `72431e6` | `envInsecureDefaults.test.ts` (8) — **3 fail pre-fix** |
| **10.6** | Scheduled restore drill (DEV-10) | DONE | `8d7a8f7` | `backup-restore-drill.yml` |
| **11.1** | `Control.status` vs the score (ARCH-4) | DONE — **decision made** | `74c3e10` | `scoringSemantics.test.ts` (13) |
| **11.2** | Code-split the AI Advisor (§8 MEDIUM-1) | DONE | `74c3e10` | same suite |
| **11.3** | `RouterInputs` at the tRPC boundary (§8 MEDIUM-2) | **PARTIAL, deliberately** | `74c3e10` | same suite |

---

## 3. VERIFIED vs. ASSUMED — no silent upgrades

| Audit item | Was | Now | Why |
|---|---|---|---|
| `LimitRange` vs. the Ollama Pod (§5) | ASSUMED | **STILL ASSUMED** | Needs `kubectl --dry-run=server` against a live cluster. **None available**: `helm`/`kubectl` are installed, but there is no kind/k3d/minikube and no current context. Not checked, so not claimed. |
| k8s manifests admit | ASSUMED | **PARTIALLY ADDRESSED, still ASSUMED for admission** | CI now runs `kubeconform -strict` over `k8s/*.yaml` — schema validation without a cluster. It does **not** run admission control. |
| Helm chart rendering | ASSUMED | **VERIFIED (client-side only)** | `helm lint` + `helm template` against all three values files; guard matrix behaves correctly. Rendering, **not** deployment — no `helm install` was run. |
| Prometheus rules / Alertmanager | — | **VERIFIED** | Real tooling: `promtool check rules` → 11 rules, `amtool check-config` → SUCCESS. |
| Advisor code-split payload win | audit **assumed** a win | **VERIFIED, and smaller than implied** | See §6.4 — Next's route table shows **no change**; the real, measured effect is on the layout chunk. |
| DNS-rebind simulation (WAVE 8) | — | **NOT PERFORMED** | Needs a domain whose resolution can change between check and fetch. Re-resolution asserted structurally instead. |
| Connector adapter coverage (`AZURE`/`GCP` null) | ASSUMED | **STILL ASSUMED** | Not re-read from `connectorRegistry`; out of scope for these waves. |
| Billing sign-off | Unverified | **STILL UNVERIFIED** | No live Razorpay test-mode cycle. |

---

## 4. BLOCKED — what I need from you

### 4.1 WAVE 6.1 — pentest scanning on Kubernetes (ARCH-1)

**The silent gap is closed; the capability is not built.** Previously a
Helm-deployed Dharma accepted scans that sat in Redis forever with no consumer,
no error and no UI signal. The chart now **fails at template time** unless the
operator states where scans run.

I deliberately did **not** close this by mounting `/var/run/docker.sock` into a
Pod. On Compose's single host that socket grants root on a host the operator
already owns; in a shared cluster it grants root on a node running other
tenants' workloads. That would be a silent **downgrade** of the isolation
`Security_Architecture.md` assumes, dressed up as parity.

**To unblock I need:**

1. **A live Kubernetes cluster** (or approval to provision a local kind/k3d) to
   validate a per-scan Job runner against. Writing it blind would break this
   pass's one non-negotiable rule.
2. **A decision on isolation approach** — per-scan Job with a scoped
   ServiceAccount, *or* a sandboxed runtime (gVisor/Kata), *or* a dedicated
   node pool with PodSecurity restrictions. `src/server/pentest/scanner.ts`
   shells out to `docker run`/`docker network create` and needs rewriting for
   whichever you pick. **My recommendation: the per-scan Job with a scoped
   ServiceAccount** — it needs no special runtime or node pool, and it is the
   only option that keeps the blast radius per-scan the way Compose's separate
   container does.

### 4.2 Standing blockers (carried forward, not from this pass)

- **A controllable test domain** — blocks WAVE 0.1's DNS-challenge E2E and
  WAVE 8's DNS-rebind simulation.
- **Billing sign-off** — a live Razorpay test-mode cycle.

---

## 5. Deliberately not done

- **WAVE 11.3's broader `RouterOutputs` pass.** The concrete drift the audit
  named is fixed and **55 hand-written prop interfaces remain**. Recorded rather
  than quietly counted as complete.
- **`permissionProcedure` on `apiKey`, `endpoint`, `regulatory`, `settings`,
  `webhook`.** These gate on admin/manager and have **no matching
  `PERMISSION_KEY`**. Inventing one would be a guess at product intent, not a
  fix. The audit's complaint was specifically the 13 keys settable in the Roles
  UI that enforced nothing — those are now enforced.

---

## 6. Corrections to the audit

Each of these changed what I built, so they are recorded rather than silently
worked around.

**6.1 §6 HIGH-1's headline example is wrong.** The state-coverage table counted
occurrences of `isError` only and reported `/dashboard` as having "12 loading
indicators and zero error branches". `dashboard/page.tsx` destructures `error`
(not `isError`) and has **always** rendered a distinct `<LoadFailure/>` — the
audit's own repro would have shown an error card, not a zero state. Re-surveyed
counting both spellings: the genuine gap was **eight other pages**.
/dashboard's real shortcoming was no retry affordance.

**6.2 DEV-6 overstated the exposure.** Bare `nextauthSecret: "CHANGE_ME"` (9
chars) was **already** refused by the schema's existing `min(32)` rule. The real
gap was the *URL-embedded* and MinIO placeholders. My first draft of that test
passed for the wrong reason — a ZodError also names the variable — so it now
asserts the guard's own message.

**6.3 fix-log 0.4's caveat is closed.** `tests/scanAnomaly.test.ts` had never
been executed. Run: 5/5 green.

**6.4 §8 MEDIUM-1 implied a bundle win the route table does not show.**
`/dashboard` reports **196 kB First Load JS before and after** the code-split —
that column is dominated by shared framework chunks. The real, measured effect
is the dashboard **layout chunk**, loaded on every dashboard route:
**29,666 → 18,200 bytes (−38.6%)**. Stating the number I measured rather than
the improvement the finding implied.

---

## 7. Things worth knowing

**7.1 I introduced a regression and the gate caught it.** Caching the joined
`CustomRole` in WAVE 5.1's identity cache broke Phase 8's explicit "permission
changes take effect immediately" guarantee — editing a role is not a `User`
write, so the cache went stale. Fixed by caching **User scalars only** and
reading `CustomRole` fresh. That is why 5.1's cache holds `customRoleId` and not
the permission map.

**7.2 Two test suites were passing for the wrong reason**, throughout the entire
window their vulnerability was open. `marketplace.router.test.ts` asserted
"publishItem calls service with auth ctx" while the router had **no**
authorization check; `import.router.test.ts` passed a context with no prisma
client at all. Both rewritten against the real database. A mock-only test of an
authorization path is worse than no test — it reports safety it never checked.

**7.3 16 tests across 9 suites asserted a role only in the session** while the
seeded row said ADMIN. That is precisely the escalation BE-1 describes, so after
5.1 it is no longer a way to hold a role. Corrected via one shared
`tests/fixtures/seedRoleUser.ts` rather than six copies.

**7.4 `prisma migrate diff` caught a schema/migration divergence of mine** — a
*partial* index in SQL that Prisma cannot express in the schema, so the two
would never have matched. Resolved by dropping the index (the only access path
is `findUnique` by id). Two **pre-existing** drifts remain and are not from this
pass — the `vector` extension and a removed `Control.path` index — confirmed
identical at HEAD.

**7.5 The `offsetParent` focus-trap trap.** The usual visibility shorthand is
null for `position:fixed` elements — which the dialog is — and always null under
jsdom. It would have emptied the focusable list and silently degraded the trap
to "focus the container" while looking correct. Uses `checkVisibility()`.

**7.6 `amtool` rejected a templated Alertmanager config**, which is why the
webhook URL uses `url_file` against `monitoring/secrets/` rather than
environment substitution. An alerting config that no tool can validate is how
DEV-4 happened in the first place.

**7.7 Environment instability during the pass.** Docker Desktop stopped twice,
taking Postgres/Redis/MinIO with it; both times restarted and the suite
re-verified. Separately, **an external process checked the working tree out to
branch `Hem` and pulled**, mid-pass (`git reflog`: `checkout: moving from main
to Hem`, then `pull --tags origin Hem`). No work was lost — all commits are on
`main`, which is **ahead of `origin/main` by 5 and has not been pushed**. I
switched back to `main` and re-verified the full suite. Worth knowing if you
were mid-something on `Hem`.
