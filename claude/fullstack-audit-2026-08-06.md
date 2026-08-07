# Dharma — Full-Stack Audit, 2026-08-06

**Scope:** architecture, app flow, DevOps, UI/UX, backend, frontend.
**Mode:** read-only. Nothing was fixed, edited, or committed in this pass.
**HEAD:** `8c60469` (`main`), working tree dirty — see §1.
**Severity scale (one scale, all six domains):** CRITICAL = data loss, security/legal
exposure, or the core product loop is broken · HIGH = real user-facing or operational
risk · MEDIUM = real but contained · LOW = polish.
**Evidence tags:** VERIFIED (read the code / ran the command) · INFERRED (reasoned from
adjacent evidence) · ASSUMED (could not check — reason stated).

---

## 1. Starting-state note

I read, in order: `Dharma_Master_Context.md` and `Development_Status.md` (49 models, 31
routers, 14 queues/16 workers, Phase 0–9 built, four items still open: billing sign-off,
Azure/GCP connectors, ZAP/Burp import, deployment runbook); `LAUNCH_READINESS_REPORT.md`
(2026-08-02, 13 findings A1–C2, the `/api/test-auth` bypass being the serious one, plus
10 explicit out-of-scope gaps); `PROJECT_UNDERSTANDING_GUIDE.md` (index only — its content
is superseded by the vault and the reports below); `claude/fix-log.md` in full (WAVE 0
closed 2026-08-05; WAVE 1–4 verified already-done by prior commits; 4.2b listed OPEN);
`claude/infra-audit-2026-08-04.md` (MinIO rotation, the completely-non-functional backup
system now fixed **and drilled**, branch protection enabled, dead-letter alerting proven
firing, and the unresolved self-hosted-vs-hosted decision); and the technical vault
(`Database_Design`, `Security_Architecture`, `Threat_Model`, `Authorization`,
`System_Architecture`, `Deployment`, `Observability`) plus `03_PRODUCT/`
(`User_Journeys`, `Feature_Backlog`, `Roadmap`). The `code-review-graph` MCP graph is
live and fresh (built at `8c60469`, head matches build; 365 files, 1841 nodes, 16026
edges) — I used it for stats and orientation, but it has **0 embeddings**, so
`semantic_search_nodes` is unavailable and structural exploration fell back to targeted
Grep/Read.

Three corrections to the starting documents, all resolved in favour of the code:

- **`claude/fix-log.md` is stale on its only open item.** It lists 4.2b (Cross-Walk matrix
  auto-population) as "STILL OPEN"; commit `9f761fe feat(crosswalk): embedding-similarity
  first pass with human review — closes 4.2b` (plus `87bacc8`) landed it. The staged diff
  on that file (`git diff --cached --stat` → `claude/fix-log.md | 2 +-`) is the 0.4 test
  row, not the 4.2b row.
- **`claude/infra-audit-2026-08-04.md` §1.1 says "the payment provider is Stripe, not
  Razorpay… no Razorpay code anywhere."** That was true on 2026-08-04 and is now false —
  `07d6db4 feat(billing)!: remove Stripe and make Razorpay the sole payment provider`.
  Read that document's §7 Stripe-webhook alerting rows as historical.
- **`04_TECHNICAL/Deployment.md` "Open Questions" asks whether k8s or Helm is
  authoritative.** That is now answered in code (`k8s/nextjs.yaml` and `k8s/ingress.yaml`
  carry DEPRECATED banners; `k8s/namespace.yaml` is still in use) — but **only in the
  working tree**, uncommitted. See DEV-3.

**Working tree is dirty and carries real, uncommitted infrastructure work**: modified
`k8s/{ingress,namespace,nextjs}.yaml`, `helm/dharma/README.md`, `.github/workflows/deploy.yml`;
untracked `helm/dharma/values-{production,staging}.yaml`, `scripts/seal-secrets.sh`,
`docs/ops/`; staged `tests/scanAnomaly.test.ts`. Every DevOps finding below is against
the working tree, since that is what a deploy would use once committed.

Prior fixes I re-verified as still holding, so they are **not** re-flagged: no `use()`
calls remain anywhere (`grep -rn "= use(" src` → 0 hits, WAVE 1.1); the `?? fallback`
permission-gating anti-pattern is gone (`settings/general/page.tsx:68` now reads
`sessionQuery.isSuccess && sessionQuery.data?.role === "ADMIN"`, WAVE 2.3); no payment
SDK is mounted globally (`src/app/providers.tsx` mounts only SessionProvider /
ThemeProvider / TRPCReactProvider / Toaster, WAVE 3.2); the acronym map and
`NON_ROUTE_SEGMENTS` breadcrumb fix are in `src/lib/navigation.ts:107-129` (WAVE 4.4);
and 62 of 64 schema relations carry an explicit `onDelete` (WAVE 3.4b).

---

## 2. Executive summary

**Dharma is in better infrastructural shape and worse product shape than the last audit
suggested.** The plumbing built in the last four days is genuinely strong — the audit
hash chain, the backup-and-restore drill, the queue configuration, and the CI image
pipeline all hold up under scrutiny. But this pass went where prior audits hadn't, and
found that **three shipped modules are effectively unreachable or unfinished**: the
Policies module has no detail page, no update/publish mutation, and a dead empty state,
so the flagship "AI policy generation" feature produces documents that can never be
reviewed or published; the MSSP dashboard, Publisher, and Admin Marketplace pages (7
routes) have **zero inbound links anywhere in the app**; and `marketplace.ts` ships with
`// Basic check, in reality verify role is PUBLISHER or ADMIN` above a mutation with no
check, letting any signed-in user self-publish tenant-importable content. Worse, because
auth is a 30-day JWT that is never re-read against the database, **deactivating or
removing a user does not revoke their access** on 25 of 31 routers.

**Highest-leverage next action:** re-read the user row inside `orgProcedure` (one
middleware, ~15 lines). That single change closes the offboarding hole (BE-1), makes
custom-role RBAC actually enforce on the whole API instead of 6 routers (BE-2), and
removes the strongest argument against the multi-replica Helm topology. It touches
Architecture, Backend and DevOps at once.

---

## 3. Domain 1 — System architecture

Runtime topology as built: 17 Compose services in four groups (core `caddy`/`nextjs`/
`postgres`/`redis`/`minio`/`ollama`; one-shot `minio-init`/`ollama-init`; workers `worker`
+ `pentest-worker`; ops `backup-scheduler` + Prometheus/Grafana/otel-collector/three
exporters). Healthcheck-gated `depends_on` was cold-boot–proven on 2026-08-04
(`infra-audit-2026-08-04.md` §8) and is not re-derived here. Production topology is
`helm/dharma` (app + worker only) over a data layer applied from `k8s/*.yaml`.

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| CRITICAL | **The Helm chart deploys no pentest worker.** Compose deliberately splits `pentest-worker` into its own container so only it holds the host Docker socket (`docker-compose.yml:343-350`, `docker/pentest-worker/Dockerfile:6`, entrypoint `CMD ["npx","tsx","src/workers/pentestScanRunner.ts"]`). `src/workers/index.ts` — the entrypoint of the Helm `worker` Deployment — never imports `pentestScanRunner`. `find helm -type f` lists `deployment-app.yaml` and `deployment-worker.yaml` only. **Repro:** deploy via `helm upgrade --install` (the path CI takes), then start a scan from `/dashboard/pentests`. `pentest.create` accepts it, `PenTest` goes to a queued state, and the job sits in Redis forever with no consumer — no error, no timeout, no UI signal. The security-critical Docker-socket isolation Compose provides also has no Kubernetes equivalent at all. | VERIFIED |
| HIGH | **Production runs 3–10 app replicas against an in-process rate limiter.** `src/server/lib/rateLimit.ts:11` is a module-level `Map`; its own comment says "If Dharma ever runs multiple Next.js replicas behind a load balancer, this should move to a Redis-backed counter." `helm/dharma/values-production.yaml` sets `app.replicaCount: 3` and `autoscaling.maxReplicas: 10`. Every threshold is therefore silently 3–10× its intended value in production, and non-deterministically so under HPA. `Security_Architecture.md` flags the constraint; nothing reconciles it with the production values file that now makes it real. **Repro:** any rate-limited procedure, hit round-robin across replicas. | VERIFIED |
| HIGH | **The audit chain proves non-alteration, not non-omission.** `emitAuditEvent` (`src/server/services/audit/writer.ts:38`) enqueues by default; the mutation commits independently of the audit write. If the job exhausts its 5 attempts (`auditEventQueue.ts`), the chain remains *valid* — it simply has no entry for that mutation, and `audit.verifyIntegrity` returns OK. A dead-letter CRITICAL alert fires (`attachDeadLetterAlerting`), so it is not silent, but nothing in the product reconciles mutations against audit rows. For a tamper-evidence claim sold to auditors, "nothing was changed" and "nothing is missing" are different guarantees and only the first is delivered. | VERIFIED |
| HIGH | **`Control.status` does not affect the readiness score.** `readinessScoring.ts:16-21` — `evidenceScore = (evidencedLeaves/totalLeaves)*85`, `mappingBonus ≤ 15`; `grep -n "status" readinessScoring.ts` shows the only `status` references are `ControlMapping.status='ACCEPTED'` and `RecommendationStatus`. `Control.status` is never read. **Repro:** mark every control COMPLIANT via `control.updateStatus` (`src/server/routers/control.ts:170`); framework readiness stays at 0%. Conversely, attaching any non-expired file to every leaf yields 85% regardless of the file's relevance. The design rationale is documented honestly in the file header, but nothing in the UI tells the compliance officer that the number they are managing toward ignores the field they are setting. | VERIFIED |
| MEDIUM | **Audit-log timestamps are write times, not event times.** `auditEventQueue.ts:22` documents `emittedAt` as "recorded into changes for write-lag visibility"; `auditEventWorker.ts:39` does `const { emittedAt, ...input } = job.data` and uses it only for a returned `queuedForMs`. `createAuditLog` stamps `new Date()` at write time (`audit-log.ts:52`). Under queue backlog the recorded timestamp drifts from the actual event. Doc-vs-code disagreement inside the same module; code wins. | VERIFIED |
| MEDIUM | **Ollama is a hard dependency for more than the Advisor.** `completionClient.ts`, `advisorHealth.ts`, plus the control-embedding, evidence auto-tag, AI-ingestion and policy queues all target it. Redis down is the wider blast radius: `emitAuditEvent` degrades gracefully to a synchronous write (`writer.ts:53-61`) — good — but every other enqueue path has no such fallback, and several swallow the failure (`evidence.ts:256` `.catch(() => {})`). | VERIFIED |
| LOW | Tenant scoping sampled across `evidence`, `control`, `readiness`, `organization`, `import`, `policy`, `controlMapping`: every query resolves `organizationId` from `ctx.session.user.organizationId`, never from input. `readiness.ts:9` `frameworkInOrg()` is the pattern others follow. No client-supplied-org-id violations found. | VERIFIED |

---

## 4. Domain 2 — App flow

Verified by **code inspection only** — no dev server was started and no browser was
driven in this session, so nothing below is a live-render observation.

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| CRITICAL | **The Policies journey dead-ends after generation.** `find src/app/dashboard -name page.tsx` returns `policies/page.tsx` and `policies/new/page.tsx` — there is **no `policies/[id]`**. `src/server/routers/policy.ts` exposes only `list`, `create`, `listTemplates`, `generateFromTemplate`, `reviewDraft`, `getReviewStatus` — **no `getById`, `update`, `publish`, or `delete`**. `isPublished` is settable only at create time (`policy.ts:56`). The list cards (`policies/page.tsx:22-40`) are not links and render raw markdown under `line-clamp-3`. TipTap is imported in exactly one file (`policies/new/page.tsx`). **Repro:** generate a policy, return to `/dashboard/policies`, and there is no way to open, edit, publish, export or delete it — ever. This breaks `User_Journeys.md` flow 3 ("TipTap review/edit → publish → AuditLog entry") at the review step. | VERIFIED |
| HIGH | **Seven routes have zero inbound links.** `grep -rn "/dashboard/mssp\|/dashboard/publisher\|/dashboard/admin/marketplace" src --include='*.tsx' --include='*.ts'`, excluding each route's own directory, returns **nothing**. Affected: `mssp/`, `mssp/grants/`, `mssp/[orgId]/`, `publisher/items/`, `publisher/publish/`, `admin/marketplace/`, `admin/marketplace/[id]/`. `src/lib/navigation.ts` has 12 entries and none of them; `settings/layout.tsx` has 11 tabs and none of them. The MSSP dashboard is a headline Phase 8 deliverable that a customer can only reach by typing the URL. | VERIFIED |
| HIGH | **The Policies empty state is a dead end** — the same defect shape fix-log 1.2 checked for Pentests and found already-fixed, never re-checked elsewhere. `policies/page.tsx:42-49` renders a Card reading "Create your first draft from the policy workflow" with **no link, no button, no CTA**, and the page has no "New Policy" action in its header either. The only route into `/dashboard/policies/new` in the entire app is `QuickActionsCard.tsx:29` on the dashboard root. | VERIFIED |
| MEDIUM | **`/dashboard/settings/imported-items` is missing from the settings sub-nav.** It exists as a route and is linked only from `ImportedFrameworksCard.tsx:48` on the dashboard. `settings/layout.tsx:12-36` lists 11 tabs; this is the 12th settings route. | VERIFIED |
| MEDIUM | **`/dashboard/controls` has no list page** — only `controls/[id]/page.tsx`. Controls are reachable only by drilling through a framework. Defensible, but it means a breadcrumb on a control detail page renders a "Controls" crumb linking to a 404 (`breadcrumbsFor` only nulls `/dashboard/settings/enterprise`, `navigation.ts:129`). Same class as the bug `afe724f` fixed for the enterprise segment. | VERIFIED |
| MEDIUM | `settings/connectors/page.tsx` renders no loading, error, or empty state of its own — it delegates entirely to `<ConnectorsList />` with no boundary. Combined with the `AZURE`/`GCP` adapters being `null` in the registry (`Development_Status.md`), selecting either in the wizard fails at runtime rather than being disabled at selection time. Registry claim is VERIFIED via the vault; the wizard's disable behaviour is INFERRED (not read). | MIXED |

---

## 5. Domain 3 — DevOps

Three workflows: `deploy.yml` (push to main/develop + PRs to main), `e2e.yml` (main),
`infra-validate.yml` (paths-filtered on terraform/helm/k8s/workflows).

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| CRITICAL | **No database migration runs on deploy.** Neither `deploy-staging` nor `deploy-production` in `.github/workflows/deploy.yml` executes `prisma migrate deploy`; there is no migration Job, initContainer, or Helm hook anywhere under `helm/dharma/templates/`. `npm run db:deploy` exists in `package.json` and is never called by CI. **Repro:** merge a schema migration to `main` with `ENABLE_K8S_DEPLOY=true`; new pods roll out against the old schema and every query touching the new column throws until someone runs the migration by hand. `--atomic` makes it worse, not better: the pods can pass their `/api/health` probe and be declared healthy while the application is broken. | VERIFIED |
| HIGH | **The Helm/raw-manifest naming resolution is complete for the deploy step and missed in the verify step.** `deploy.yml:469-472` still runs `kubectl get pods -n dharma -l app=nextjs` and `kubectl describe deployment nextjs -n dharma`. The Helm chart names its Deployments `dharma-app`/`dharma-worker` and labels pods `app.kubernetes.io/name: dharma` (`_helpers.tpl`; stated explicitly in `k8s/nextjs.yaml`'s own deprecation banner). **Repro:** enable `ENABLE_K8S_DEPLOY` and push to main. The Helm upgrade succeeds; `kubectl describe deployment nextjs` exits non-zero with NotFound and fails the job *after* a successful production rollout. The `get pods -l app=nextjs` line is worse — it exits 0 and prints nothing, so it looks like a passing check that verifies nothing. This is exactly the "others of the same shape" case: same root cause, adjacent lines, unfixed. | VERIFIED |
| HIGH | **The production smoke test targets a placeholder domain.** `deploy.yml:476` hardcodes `NEXTJS_URL="https://dharma.example.com"`, matching the placeholder in `values-production.yaml` (`host: dharma.example.com # replace with your real production hostname`). The check either fails permanently or, once someone points DNS somewhere, curls a host nobody chose. | VERIFIED |
| HIGH | **Prometheus alerting is configured to load rules from a directory that does not exist.** `monitoring/prometheus.yml:36` sets `rule_files: ["rules/*.yml"]`; `ls monitoring/rules` → *No such file or directory*. Alertmanager is commented out (`prometheus.yml:30-33`). Prometheus tolerates a non-matching glob silently, so the stack loads zero rules and reports no error. The only working alert channel is `src/server/lib/ops/alert.ts` (stdout CRITICAL + optional webhook), which is app-level: **Postgres down, Redis down, queue backlog, and `probe_success == 0` alert nobody.** `Observability.md` states "No alerting" — this confirms it and adds that the config actively pretends otherwise. | VERIFIED |
| MEDIUM | **`infra-validate.yml` never templates the values files CI actually deploys with.** Its `helm` job runs `helm template` against default `values.yaml` and against an all-toggles-on `--set` combination, but never `-f values-production.yaml` or `-f values-staging.yaml` — the only two files a real deploy uses. It also triggers on `k8s/**` while running no validation against `k8s/*.yaml` at all (no `kubectl --dry-run`, no kubeconform). | VERIFIED |
| MEDIUM | **The production-secret guard does not cover the Helm chart's placeholders.** `src/env.ts:107-118` denies the exact strings shipped in `envs/.env.example` (`minioadmin`, `replace-with-a-random-32-character-secret`, `change-me-32-char-key-*`). `helm/dharma/values.yaml` ships a *different* placeholder vocabulary: `nextauthSecret: "CHANGE_ME"`, `databaseUrl: "postgresql://dharma:CHANGE_ME@postgres:5432/…"`. `CHANGE_ME` is not in `INSECURE_DEFAULTS`, so a `helm install` at default values (`secrets.create: true`) boots happily in production with `NEXTAUTH_SECRET=CHANGE_ME`. Staging/production values set `secrets.create: false`, and CI preflights `dharma-app-secrets` — so the *CI* path is safe; a manual `helm install` is not. | VERIFIED |
| MEDIUM | **The failure notifier only covers deploy failures.** `deploy.yml:482-484` — `notify` has `needs: [deploy-production, deploy-staging]`. When `lint`, `test`, `build` or `scan` fails, the deploy jobs are *skipped*, not failed, so `notify` is skipped too. A red test on `main` sends no Slack message. | VERIFIED |
| MEDIUM | **`auth_attempts_total` is instrumented and never dashboarded.** Defined in `src/lib/observability/metrics.ts`; `grep '"expr"' monitoring/grafana/dashboards/dharma-overview.json` shows panels for pg/redis exporters, `trpc_request_duration_ms`, `queue_jobs_processed_total`, `queue_job_duration_ms`, `probe_*` — no auth panel. Failed-login rate is the one security metric a GRC buyer will ask about. | VERIFIED |
| MEDIUM | **Restore capability is real but unrepeatable.** `scripts/restore-{pg,minio}.sh` exist and a genuine end-to-end restore drill was performed on 2026-08-04 (`infra-audit-2026-08-04.md` §5, including a byte-identical MD5 and a boot against restored data). But `grep -rln restore tests/` returns no restore test, and no CI job exercises it. The backup is verified as of one manual run by a session that has ended; it is not verified *continuously*. That is much better than the pre-2026-08-04 state (backups had never produced a file) and still short of a backup you can trust without re-drilling. | VERIFIED |
| MEDIUM | **The authoritative infra resolution is uncommitted.** The DEPRECATED banners on `k8s/{nextjs,ingress}.yaml`, the NetworkPolicy selector migration in `k8s/namespace.yaml`, both `values-*.yaml`, `scripts/seal-secrets.sh` and `docs/ops/secrets-management.md` exist only in the working tree (`git status`). CI's deploy jobs reference `values-staging.yaml`/`values-production.yaml` by path — **on a fresh clone of `main`, `helm upgrade -f ./helm/dharma/values-production.yaml` fails on a missing file.** | VERIFIED |
| LOW | `deploy.yml` `paths-ignore: ["*.md","docs/**"]` means a `docs/ops/secrets-management.md` change never revalidates. Harmless today; worth knowing. | VERIFIED |
| — | **Not checked (needs a live cluster):** whether `k8s/namespace.yaml`'s `LimitRange` max (`cpu: 2 / memory: 4Gi` per Pod) is compatible with the Ollama Pod in `k8s/minio-ollama-worker.yaml` (Compose gives Ollama an 8GB limit). If it is not, Ollama is unschedulable in that namespace. Worth 5 minutes with `kubectl --dry-run=server`. | ASSUMED |

---

## 6. Domain 4 — UI/UX

The `ui-ux-pro-max` and `impeccable` skills **are** installed in this environment. I did
not invoke them, because this pass is a read-only audit of an existing surface with no
design artifact to produce, and their heuristics (hierarchy, cognitive load, empty/error
states, a11y, consistency) are applied directly below as the standard. Flagging that
choice rather than implying skill-derived authority I didn't use.

### State-coverage matrix

Counts are occurrences of loading indicators (`isPending`/`isLoading`/`Skeleton`), error
branches (`isError`/`.error`), empty branches, and retry affordances per page file.

| Module page | loading | error | empty | retry |
|---|---|---|---|---|
| `dashboard/` (root) | 12 | **0** | 1 | **0** |
| `frameworks/` | 10 | 5 | 2 | 4 |
| `policies/` | **0** | **0** | 2 | **0** |
| `evidence/` | 2 | **0** | 1 | 1 |
| `cross-walk/` | **0** | **0** | 1 | **0** |
| `pentests/` | 10 | 5 | 2 | 5 |
| `vulnerabilities/` | 10 | 5 | 1 | 5 |
| `endpoints/` | 5 | 2 | 1 | **0** |
| `reports/` | 7 | 5 | 3 | 2 |
| `regulatory-alerts/` | 2 | 2 | 3 | **0** |
| `marketplace/` | 2 | **0** | 1 | **0** |
| `mssp/` | 5 | 1 | 1 | **0** |
| `publisher/items/` | 2 | **0** | 1 | **0** |
| `admin/marketplace/` | 3 | **0** | 1 | 2 |
| `settings/team/` | 4 | 4 | 2 | **0** |
| `settings/connectors/` | **0** | **0** | **0** | **0** |
| `settings/webhooks/` | 7 | 6 | 3 | **0** |
| `settings/api-keys/` | 4 | 2 | 2 | **0** |
| `settings/imported-items/` | 4 | **0** | 1 | 2 |
| `settings/enterprise/roles/` | 5 | 4 | **0** | **0** |

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | **Error handling correlates with which sprint touched a module, not with importance.** The seven modules `b0199f1`/`b24726c` polished (frameworks, pentests, vulnerabilities, reports, webhooks, team, roles) branch on `isError`. Ten modules do not — including **`/dashboard`, the first screen every user sees, which has 12 loading indicators and zero error branches.** **Repro:** stop Postgres, load `/dashboard`. Every card resolves its skeleton into an empty/zero state; the user reads "0 frameworks, 0 evidence, 0% ready" as a fact about their compliance posture rather than as a backend outage. | VERIFIED |
| HIGH | **`policies/page.tsx` cannot distinguish loading, error, and empty.** Lines 22-49: `policiesQuery.data?.map(...)` followed by `policiesQuery.data?.length === 0 ? <Card>No policies yet</Card> : null`. While loading, `data` is `undefined`, both branches render nothing, and the page shows a bare heading. On error, identical. This is the exact defect class fix-log 2.3 closed for Settings → General, present unfixed on a primary module. | VERIFIED |
| MEDIUM | **The shared `Dialog` promises a focus trap it does not implement.** `src/components/ui/dialog.tsx:108` comments "Trap focus inside modal and close on Escape"; the effect below it (109-121) registers a `keydown` listener handling **only** `Escape`. There is no focus containment, no initial focus, and no focus restore on close. `role="dialog"` and `aria-modal="true"` are set (135-136) but there is no `aria-labelledby`. **Repro:** open New Scan (`pentests/NewScanModal.tsx`) and press Tab repeatedly — focus walks the page behind the modal. Affects all six modals, since they all consume this primitive (`AddFrameworkModal`, `ControlDetailModal`, `LogFindingModal`, `NewScanModal`, `EvidenceUploadModal`, `ImportModal`). WCAG 2.4.3 / 2.1.2. | VERIFIED |
| MEDIUM | **Two destructive flows bypass the shared confirm dialog for native `window.confirm`.** `settings/imported-items/page.tsx:23` ("will delete the copied framework and all its data") and `controls/ControlTree.tsx:222`. `src/components/ui/confirm-dialog.tsx` — built in `b0199f1` precisely for this — is used in only three places (`EvidenceTable`, `reports/page.tsx`, `BillingManage`). Native `confirm()` is unstyled, unbranded, and blocks the main thread. | VERIFIED |
| MEDIUM | **`empty-state.tsx` is used in 4 files across ~20 list views**, so most modules hand-roll their own. Concretely: `frameworks` uses one shape, `policies` a bare Card with no CTA, `settings/connectors` none at all. There is no consistent "empty + primary action" pattern, which is why HIGH-2 above happened. | VERIFIED |
| MEDIUM | **Engineering literacy assumed in places the buyer won't have it.** Marketplace/publisher forms take a raw `slug` (`marketplace.ts:89` `slug: z.string().min(3)`) with no generation from the name. Error copy in the marketplace path surfaces as tRPC `INTERNAL_SERVER_ERROR` with the literal string `Unauthorized` (see BE-4). Positively: cron strings *are* humanized (`src/lib/cronHumanize.ts`, WAVE 4.5) and acronyms *are* mapped (`navigation.ts:107`), so the convention exists — it just hasn't been applied everywhere. | VERIFIED |
| LOW | Information hierarchy on `/dashboard/frameworks` is sound: `FrameworkCard.tsx:222` makes the readiness score the dominant element via `ScoreGauge`, with control counts secondary. The sidebar's Comply/Defend/Insight grouping (`navigation.ts:41-76`) is a genuinely good call, documented with its reasoning inline. | VERIFIED |
| — | **Colour-contrast ratios on status/severity badges were not measured.** `status-badge.tsx` and `severity-badge.tsx` use `dharma-*` semantic tokens whose computed values live in `tailwind.config.ts`; verifying contrast needs rendered output. No WCAG contrast claim is made here in either direction. | ASSUMED |

---

## 7. Domain 5 — Backend

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| CRITICAL | **BE-1 — Offboarding does not revoke access.** `src/server/auth.ts:136-138` uses `strategy: "jwt"`, `maxAge: 30 days`. The `jwt` callback (186-199) populates `role`/`organizationId` **only when `user` is present, i.e. only at sign-in**; every later request returns the token untouched with no DB read. `isActive` is checked in `signIn` (167-170) — sign-in time only. Deactivation writes `isActive: false` in exactly two places: `organization.ts:169` (admin removes a member) and `scim.service.ts:380` (SCIM deprovision). **Repro:** an employee is offboarded via Settings → Team or via the customer's IdP over SCIM. Their already-open browser session keeps full access — read and write — to every org router for up to 30 days: evidence upload and delete, control status, reports, pentest requests, connectors. Only the six routers using `permissionProcedure` refuse them, because `requirePermission.ts:29` re-reads the user row. For a compliance product whose buyer is audited on access revocation, this is the finding to fix first. | VERIFIED |
| CRITICAL | **BE-2 — Marketplace publishing and approval are effectively unauthenticated by role.** `src/server/routers/marketplace.ts:100-102`: `// Basic check, in reality verify role is PUBLISHER or ADMIN` sits directly above `return MarketplaceService.publishItem(ctx.session.user.id, input)` — **there is no check**. `MarketplaceService.publishItem` (`services/marketplace.ts:107`) verifies authorship only on *update*, never on create. Worse, the input schema accepts `isPublic: z.boolean().optional()` (line 98) and passes it straight into `db.marketplaceItem.create`, so **the `approveItem` moderation step is bypassable by setting one field**. And `approveItem`/`getPendingItems` (127-136) gate on `ctx.session.user.role !== "ADMIN"` — that is *any tenant's* admin; there is no platform-admin concept, so any customer's admin can approve any item into the shared catalogue. `metadata: z.any()` (line 97) is unvalidated JSON that other tenants then import. **Repro:** as any signed-in user, call `marketplace.publishItem({ type:"FRAMEWORK", …, isPublic:true, metadata:{…} })`. The item is immediately live and importable by every other tenant. This is precisely the Marketplace threat `Threat_Model.md` lists as "not covered in source docs". | VERIFIED |
| HIGH | **BE-3 — Custom-role RBAC enforces on 6 routers out of 31.** `permissionProcedure` is imported by `audit`, `organization`, `mssp`, `roles`, `whiteLabel`, `sso` only. Everything else uses `managerProcedure`/`adminProcedure`, which check `ctx.session.user.role` — the **legacy enum from the JWT** (`trpc.ts:141-160`). Of the 22 keys in `PERMISSION_KEYS`, at least 13 (`controls.*`, `evidence.*`, `policies.*`, `billing.manage`, `connectors.manage`, `pentest.request`, `vulns.manage`, `marketplace.publish`, `reports.generate`) are settable in the Roles UI and enforce nothing. **Repro:** create a custom role with `evidence.upload: false`, assign it to a user whose legacy `Role` is `COMPLIANCE_MANAGER`. They can still upload evidence. `requirePermission.ts:11-14` documents this honestly as a "follow-up migration" — the problem is that the UI sells the feature as complete. | VERIFIED |
| HIGH | **BE-4 — SSRF discipline was applied to pentest and nowhere else.** `grep -rn "validateScanTarget\|isPrivateIp"` hits only `src/server/pentest/scanner.ts` and `routers/pentest.ts`. Four other server-side fetches take a user-supplied host with no private-range check: **`services/audit/siem-export.ts:68`** (`config.url` validated by `z.string().url()` only, at line 19 — and this endpoint is where the *audit log* gets shipped, so `http://169.254.169.254/…` is both an SSRF and an exfil target); **`queue/workers/webhookWorker.ts:68`** (HTTPS is enforced at `routers/webhook.ts:19-22`, which blocks the plain-HTTP metadata endpoints, but `https://10.0.0.5/` and redirect-to-internal are both still reachable); **`services/sso/saml.service.ts:162`** (HTTPS enforced, no private-range block); and the Jira/Okta connectors, whose base URL comes from user config (`jiraConnector.ts:43`, `oktaConnector.ts:40`). | VERIFIED |
| MEDIUM | **BE-5 — Three routers write no audit entries at all.** `grep -c "createAuditLog\|emitAuditEvent" src/server/routers/*.ts` → `marketplace.ts:0`, `import.ts:0`, `user.ts:0`. `import.ts` has 2 mutations including `importFramework`/`unimportFramework` — importing a third-party control set into a tenant's compliance programme, and deleting it again, is exactly the event an auditor asks about. `marketplace.ts` has 4 mutations including publish and approve. | VERIFIED |
| MEDIUM | **BE-6 — `import.ts` and `marketplace.ts` skip `orgProcedure`.** Both use bare `protectedProcedure` (`import.ts:1`, `marketplace.ts:3`), so `enforceOrganizationContext` never runs. Tenant scoping still holds — every query passes `ctx.session.user.organizationId` explicitly — but a session with no org yields `organizationId: ""` (set at `auth.ts:203`), so `importFramework` attempts a write with an empty FK and surfaces a Prisma 500 instead of the clean `UNAUTHORIZED` every other router returns. | VERIFIED |
| MEDIUM | **BE-7 — Marketplace is the only router leaking raw exceptions.** 4 × `throw new Error(...)` (`marketplace.ts:28,75,118,130`) versus `TRPCError` everywhere else in the codebase — these reach the client as `INTERNAL_SERVER_ERROR` with no actionable code. `marketplace.ts` also imports `prisma as db` directly (line 5) rather than using `ctx.prisma`, so it cannot be swapped in tests. | VERIFIED |
| MEDIUM | **BE-8 — `redis.keys()` on every marketplace publish.** `services/marketplace.ts` runs `await redis.keys("marketplace:public:*")` on each write, with a comment acknowledging it ("brute force pattern match is slow in Redis… avoid in huge prod"). `KEYS` blocks the Redis single thread — and that is the *same* Redis instance backing all 14 BullMQ queues. | VERIFIED |
| LOW | Queue failures reach a CRITICAL log line and an optional webhook, but nothing in the product. `Evidence.embeddingStatus` has a `FAILED` state in the schema; a user whose evidence never embeds sees no in-app explanation. | INFERRED |
| — | **Solid, verified:** every one of the 14 queues sets explicit `attempts` + `backoff` tuned to its workload (audit 5×/5s exp, pentest 2×/30s fixed, billing 3×/30s exp, embeddings 3×/2s exp) — no queue is running on framework defaults. 62 of 64 relations carry explicit `onDelete`; the two that don't are `Organization.plan` (line 78, safe-direction Restrict) and `PenTest.requestedBy` (line 925, already reasoned through in fix-log §3.4b). | VERIFIED |

---

## 8. Domain 6 — Frontend

| Sev | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | **The server/client split is not a split — nearly every real page is a client component.** 60 of 115 `.tsx` files under `src/app` carry `"use client"`; of the 55 that don't, 42 are the metadata-only `layout.tsx` shims created for B3. Effectively **zero pages fetch on the server**, so every route is an empty shell plus a client-side tRPC waterfall. This is the structural cause of the state-coverage gaps in §6: with no server fetch there is no `loading.tsx`/`error.tsx` boundary to fall back on, and each page must hand-roll all three states — which is exactly what half of them skip. | VERIFIED |
| MEDIUM | **The entire AI Advisor UI ships on every dashboard route.** `src/app/dashboard/layout.tsx:14,32` statically imports and mounts `AIAdvisorTrigger`, which statically imports `AIAdvisorPanel` → `MessageBubble`, `MessageInput`, `DocumentUploadPanel`, `CitationChip`, `ContextBar`, `TypingIndicator`. `grep -rn "next/dynamic" src --include='*.tsx'` returns **zero hits app-wide** — there is no code-splitting anywhere. Same shape as the Stripe-global-load issue (WAVE 3.2), different payload. | VERIFIED |
| MEDIUM | **`RouterOutputs` is exported and never consumed.** `src/lib/trpc.ts:24` defines `export type RouterOutputs = inferRouterOutputs<AppRouter>`; `grep -rn "RouterOutputs"` returns only that definition. Instead there are 55 hand-written `interface …Props` declarations under `src/components`, each free to drift from the router contract. Concrete drift-enabler: `settings/webhooks/page.tsx:55` casts `events: events as any` into `createMutation.mutateAsync`, defeating the Zod contract at exactly the boundary tRPC exists to protect. | VERIFIED |
| LOW | 55 `as any` / `@ts-ignore` occurrences repo-wide. The large majority are Next `typedRoutes` workarounds (`href={x as any}`, `router.replace(… as any)`) and are cosmetic. `npx tsc --noEmit` is clean. | VERIFIED |
| — | **Confirmed still fixed, not re-flagged:** no `use()` anywhere (WAVE 1.1 root cause cannot recur); no `?? fallback` gating permission-sensitive UI — the five remaining `??` uses are local UI state (`regulatory-alerts/page.tsx:98` accordion, `DharmaRing.tsx:70` reduced-motion) (WAVE 2.3); `providers.tsx` mounts no payment SDK (WAVE 3.2). | VERIFIED |

---

## 9. Cross-domain patterns

**P1 — "The security control exists, on one module."** The strongest pattern in this
codebase. A control gets built properly for the module that prompted it and is never
generalised: SSRF validation exists for pentest and not for SIEM export, webhooks, SAML,
or two connectors (BE-4); `permissionProcedure` exists for 6 Phase 8 routers and not the
other 25 (BE-3); `confirm-dialog.tsx` exists and 2 destructive flows still use
`window.confirm` (§6); `empty-state.tsx` exists and 16 list views hand-roll their own;
`isError` branching exists on the 7 polished modules and not on `/dashboard`. In every
case the *pattern* is already written and merged — the gap is application, not design.
That makes these unusually cheap fixes with unusually high leverage.

**P2 — Marketplace is the one module built to a different standard.** It is the only
router with raw `throw new Error` (BE-7), the only one importing `prisma` directly
instead of `ctx.prisma`, one of three with zero audit logging (BE-5), one of two skipping
`orgProcedure` (BE-6), the source of the missing-authorization defect (BE-2), the source
of the blocking `redis.keys()` call (BE-8), and its two admin/publisher UIs are among the
seven unreachable routes (§4). Three of its comments say "in reality, check X" — it is a
scaffold that was never finished but ships enabled. Treat it as one work item, not six.

**P3 — Compose is production-grade; Helm is a partial transcription of it.** Compose has
a pentest-worker with Docker-socket isolation, healthcheck-gated startup, and a backup
scheduler. Helm has app + worker, no pentest worker (ARCH-1), no migration step (DEV-1),
and a verify step still addressing the deleted raw-manifest resource names (DEV-2). The
self-hosted-vs-hosted decision `infra-audit-2026-08-04.md` §10 left open is still open,
and it is the reason: nobody has decided which of these two is the real deployment, so
both are half-maintained.

**P4 — Documents disagree with code, and the code is right.** Four instances, all cited
above: `fix-log.md` on 4.2b, `infra-audit` §1.1 on Stripe/Razorpay, `Deployment.md` on
k8s-vs-Helm, and two in-code comments that describe behaviour the code beneath them does
not implement (`dialog.tsx:108` "trap focus", `auditEventQueue.ts:22` "recorded into
changes"). The last pair are the dangerous kind, because a reviewer reads the comment and
stops.

---

## 10. What's already solid

- **The audit hash chain is correctly implemented.** `src/server/audit-log.ts:50-92` wraps
  each write in a `Serializable` transaction *and* takes a per-org `pg_advisory_xact_lock`
  keyed on `Organization.lockKeyId`. That is the right pair — the lock serialises chain
  writes within a tenant while letting different tenants proceed in parallel, and
  `computeAuditHash` sorts object keys recursively (17-30) so JSON key order can't
  produce a spurious mismatch. `verifyAuditChain` (95-146) checks both linkage and
  recomputed content. The omission gap in ARCH-3 is a scope limit, not a defect in this
  code.
- **Queue configuration is deliberate everywhere.** All 14 queues set explicit
  `attempts`/`backoff`/`removeOnComplete`/`removeOnFail`, tuned per workload rather than
  copy-pasted. Dead-letter alerting is attached centrally in `src/workers/index.ts` so a
  new worker gets coverage in one line — and it distinguishes an exhausted retry from an
  intermediate one, so a network blip doesn't page anyone.
- **`emitAuditEvent` fails safe.** `writer.ts:53-61` — if the queue is unreachable it
  falls back to a synchronous write rather than dropping the event. Durability over
  latency, stated as such in the comment. It is the only enqueue path in the codebase
  with this property, and it is the right one to have chosen.
- **The production-secret guard is well-reasoned.** `src/env.ts:107-142` is a deny-list of
  the *exact* published placeholders rather than a heuristic "reject anything weak", and
  it explicitly exempts `NEXT_PHASE === "phase-production-build"` so `next build` on a
  secretless CI host still works. Both decisions are correct and both are documented
  inline. (Its blind spot for Helm's `CHANGE_ME` vocabulary is DEV-6.)
- **The CI image pipeline is genuinely hardened.** `deploy.yml:184-190` derives the
  immutable tag from the same `${{ github.ref_name }}-${{ github.sha }}` expression every
  consumer uses, after a real incident where `{{sha}}` rendered short and every pull
  404'd. The two-step Trivy pattern (report at exit-code 0, then a CRITICAL-only
  `ignore-unfixed` gate) is the right split, and the reasoning for not gating on HIGH is
  correct: a gate on unactionable findings gets routed around.
- **The tenant-isolation CI gate cannot silently no-op.** `deploy.yml:116-127` asserts
  with `jest --listTests | grep -c` that the suite is still *collected* before running it,
  so a rename or `describe.skip` fails the build. That is a genuinely rare degree of care.
- **Schema delete semantics are complete.** 62 of 64 relations carry explicit `onDelete`;
  the two exceptions are safe-direction and already reasoned through.
- **The navigation module is a single source of truth** for both the sidebar and
  breadcrumbs, with the acronym map and non-route-segment set that fixed two real 404s,
  and inline reasoning for the Comply/Defend/Insight grouping.
- **Backups went from never having produced a file to being restore-drilled end to end**
  in a single session (`infra-audit-2026-08-04.md` §5), including a byte-identical
  checksum and a live app boot against restored data. The remaining gap is repeatability,
  not capability.

---

## 11. Prioritized action list

Ordered by severity, then by how many domains one fix closes.

| # | Action | Closes | Domains | Wave |
|---|---|---|---|---|
| 1 | **Re-read the user row in `orgProcedure`** (`isActive`, `role`, `organizationId`), mirroring `requirePermission.ts:29-49`. Fixes offboarding revocation, makes role demotion take effect, and removes the strongest objection to multi-replica. | BE-1 | Backend, Arch, DevOps | extends **WAVE 2.1** (session revocation — previously closed as "scoped, documented"; that scoping is no longer defensible now that SCIM deprovisioning ships) |
| 2 | **Finish or disable `marketplace.ts`.** Add the missing role check on `publishItem`, strip `isPublic` from its input, introduce a platform-admin concept for `approveItem`, validate `metadata`, convert 4 `throw new Error` → `TRPCError`, add audit logging, move to `orgProcedure` + `ctx.prisma`, and replace `redis.keys()` with a versioned cache key. If that is more than this sprint, gate the router off — shipping it enabled is the risk. | BE-2, BE-5, BE-6, BE-7, BE-8, P2 | Backend, App Flow, UI/UX | **new WAVE 5 — Marketplace hardening** |
| 3 | **Add `prisma migrate deploy` as a Helm pre-upgrade hook Job**, and deploy a `pentest-worker` from the chart (or make the chart refuse to install with pentest enabled and no worker). | DEV-1, ARCH-1 | DevOps, Arch, App Flow | **new WAVE 6 — Kubernetes parity** |
| 4 | **Build the Policies detail route and mutations**: `policies/[id]/page.tsx`, `policy.getById/update/publish/delete`, link the list cards, and give the empty state a CTA. This is the product's headline feature and it currently produces write-only documents. | §4 CRITICAL, §4 HIGH-2, §6 HIGH-2 | App Flow, UI/UX, Frontend, Backend | **new WAVE 7 — Policies lifecycle** |
| 5 | **Generalise the SSRF guard.** Lift `validateScanTarget` out of `src/server/pentest/` into a shared `assertPublicHttpTarget()`, and call it from `siem-export.ts:68`, `webhookWorker.ts:68`, `saml.service.ts:162`, and the Jira/Okta connectors. Disable redirect-following on all five. | BE-4, P1 | Backend, Arch | extends **WAVE 0.2** |
| 6 | **Fix the two remaining Helm/manifest name mismatches in `deploy.yml`** (lines 469-472 verify step, line 476 smoke-test host), and commit the entire uncommitted infra tree — CI already references files that only exist locally. | DEV-2, DEV-3, DEV-10 | DevOps | extends the `8c60469` line of work |
| 7 | **Retrofit `permissionProcedure` onto the remaining 25 routers**, or remove the 13 unenforced keys from the Roles UI so the feature stops overpromising. | BE-3, P1 | Backend, UI/UX | **new WAVE 8 — RBAC retrofit** |
| 8 | **Add `isError` + retry to `/dashboard` first**, then the nine other modules in the §6 table, using the pattern already in `frameworks/page.tsx`. Fix `policies/page.tsx`'s three-way state collapse as part of it. | §6 HIGH-1, HIGH-2, P1 | UI/UX, Frontend | extends **WAVE 2.3** |
| 9 | **Implement the focus trap `dialog.tsx` already claims**, plus `aria-labelledby` and focus restore; migrate the two `window.confirm` sites to `confirm-dialog.tsx`. One primitive, six modals. | §6 MEDIUM-1, MEDIUM-2 | UI/UX, Frontend | extends **WAVE 2.4** |
| 10 | **Create `monitoring/rules/` with real alert rules** (Postgres/Redis down, `probe_success == 0`, queue depth, dead-letter rate) and either enable Alertmanager or route rules to the existing `OPS_ALERT_WEBHOOK_URL`. Add an `auth_attempts_total` panel. Fix the `notify` job's `needs` so a red test on `main` actually notifies. | DEV-4, DEV-8, DEV-9 | DevOps | **new WAVE 9 — alerting** |
| 11 | **Link or delete the 7 orphaned routes.** MSSP in particular needs a nav entry gated on `mssp.viewAllClients`; publisher/admin need one gated on the platform-admin concept from item 2. | §4 HIGH-1, §4 MEDIUM-1 | App Flow, UI/UX | folds into WAVE 5 |
| 12 | **Decide, in the UI, what `Control.status` means** now that it provably does not move the readiness score — either feed it into the score, or label the score "evidence coverage" and show status separately. Do not leave both numbers on screen implying one drives the other. | ARCH-4 | Arch, UI/UX | **new WAVE 10 — scoring semantics** (product decision, not a code fix) |
| 13 | Lower priority: `infra-validate.yml` should template the real values files and validate `k8s/*.yaml`; add `CHANGE_ME` to `INSECURE_DEFAULTS`; add a restore smoke test to CI; `next/dynamic` the AI Advisor panel; adopt `RouterOutputs` in component props. | DEV-5, DEV-6, DEV-7, §8 MEDIUM-1, MEDIUM-2 | DevOps, Frontend | housekeeping |

---

## 12. Explicitly not verified

Stated so a later session doesn't mistake silence for a clean bill.

- **No live UI was rendered.** No dev server, no Playwright run, no browser. Every §4 and
  §6 finding is code inspection. Contrast ratios, real focus behaviour, and actual
  render-on-error were not observed.
- **No test suite was run.** The known state is `infra-audit-2026-08-04.md` §8 (75 suites,
  551 tests green on an isolated DB) plus the caveat in fix-log 0.4 that
  `tests/scanAnomaly.test.ts` has never been executed. `npx tsc --noEmit` **was** run this
  session and is clean.
- **No cluster.** The `LimitRange`-vs-Ollama question (§5), NetworkPolicy selector
  matching, and whether the Helm chart's rendered manifests actually admit are all
  untested.
- **Billing remains unsigned-off** per `Development_Status.md` — no live Razorpay test-mode
  cycle. Not re-investigated here; nothing found contradicts it.
- **Connector adapter coverage** (`AZURE`/`GCP` null, `VERCEL` legacy-only) was taken from
  the vault, not re-read from `connectorRegistry`.
