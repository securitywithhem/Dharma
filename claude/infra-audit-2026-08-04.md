# Infrastructure Audit — 2026-08-04

Scope: production-hardening audit of MinIO credentials, healthchecks, secrets
hygiene, backups, CI gating, and observability. Everything below was verified
against live config and running containers, not against prior session reports.

**Nothing has been committed.** The working tree carries all changes; `git
status` is listed at the end.

---

## 0. Headline

The brief assumed most of this infrastructure was missing. It mostly exists —
and that turned out to be the problem. Healthchecks, a backup scheduler, a
monitoring stack and a CI pipeline were all present and *looked* complete.
Three of the four did not work:

| Area | Assumed state | Actual state |
|---|---|---|
| Backups | "implement one" | Existed, **had never produced a single file**, and the dumps it would have produced were **unrestorable** |
| CI gating | "set up a pipeline" | Full pipeline existed and ran the tests — but `main` had **no branch protection**, so nothing blocked |
| Healthchecks | "add them" | Already correct for all services; two workers were missing a MinIO dependency |
| MinIO creds | "still minioadmin?" | **Yes** — plus three code modules with divergent insecure fallbacks |

The single most serious finding is the backup system: it was configured two
incompatible ways at once, both broken, and the empty `backups/` directory was
the only evidence.

---

## 1. Discrepancies between the brief and reality

Listed because the brief asked for them explicitly, not silently reconciled.

1. **The payment provider is Stripe, not Razorpay.** There is no Razorpay code
   anywhere in the repo. The webhook is `src/app/api/webhooks/stripe/route.ts`;
   the schema carries `stripeCustomerId` / `stripeSubscriptionId` /
   `stripePriceId`. All webhook alerting in Task 6 was applied to the Stripe
   endpoint. If a Razorpay migration is planned, none of it has landed.
2. **Backups already existed** (`scripts/backup-{all,pg,minio}.sh`,
   `scripts/restore-{pg,minio}.sh`, an ofelia `backup-scheduler` service).
   They were broken, not missing — see §5.
3. **CI already existed** — three workflows (`deploy.yml`, `e2e.yml`,
   `infra-validate.yml`) running lint, type-check, tests, Trivy scanning, and
   k8s deploys. The gap was enforcement, not existence.
4. **Healthchecks already existed for every service**, not just Ollama. The
   brief's suggested reference pattern (Ollama) was in place, and Postgres,
   Redis, MinIO, Next.js, Caddy, Prometheus and Grafana all had their own.
5. **`/minio/health/live` cannot be probed conventionally.** The `minio/minio`
   image ships no `curl`, `wget`, `mc`, `grep`, or `head`. The existing
   `/dev/tcp` probe was a deliberate workaround, not sloppiness. (I initially
   made this worse — see §9.)
6. **`monitoring/` already contained a full observability stack**: Prometheus,
   Grafana with provisioned dashboards, an OTel collector, and Postgres/Redis
   exporters, behind a `monitoring` compose profile. OpenTelemetry is wired
   into the app and worker.
7. **A `backups/` directory and `dharma_backups` volume already existed** and
   were mounted. Both were empty, which was the tell.

---

## 2. MinIO credentials — ROTATED (Task 1)

**Before:** `minioadmin` / `minioadmin_change_me` in `envs/.env.docker`,
`envs/.env.development`, `.env`, `.env.local`, and `envs/.env.example`.

**Rotated to** a generated 22-char access key and 40-char secret, applied to all
four live env files. `envs/.env.example` now ships `TODO_GENERATE_*` placeholders
instead of advertising the insecure default.

Verified against the running cluster:

```
=== OLD creds should now FAIL ===
OK: old credentials rejected
=== NEW creds ===
OK: new credentials authenticate
=== object count after rotation (expected 219) ===
219
=== sample object still readable ===
{ "checkType": "disk_encryption", "result": { "raw": { "fileVault": "on" }, "pass": true }, ... }
=== versioning still enabled ===
new/dharma-evidence versioning is enabled
```

All 219 existing evidence objects survived; no bucket was orphaned. A full
upload → download → presign → delete round-trip through the app container on the
new credentials also passes (§8).

### The more important half: insecure fallbacks in code

Three modules each hard-coded their own default, and **they disagreed**:

| File | Access key default | Secret default |
|---|---|---|
| `src/env.ts` | `minioadmin` | `minioadmin_change_me` |
| `src/server/minio.ts` | `minioadmin` | `minioadmin` |
| `src/lib/storage/minioClient.ts` | `minioadmin` | `minioadmin_change_me` |

A half-configured environment therefore authenticated one client and gave the
other S3 signature errors. This had already cost real debugging time — the
workaround is commented in `.github/workflows/deploy.yml:79-84`. Both client
modules now source credentials from `src/env.ts`; there is one default and one
behaviour.

### Production placeholder guard

`src/env.ts` also shipped `change-me` defaults for `NEXTAUTH_SECRET`,
`CONNECTOR_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY`, and the DB password — all
of which would boot happily in production. Added `assertNoInsecureDefaults()`:
when `NODE_ENV=production`, the process refuses to start if any secret is left
at a shipped placeholder. `docker-compose.yml` already enforced this via
`${VAR:?...}`; this extends the same discipline to deploys that bypass compose
(k8s/helm, bare `next start`).

---

## 3. Healthchecks — GAPS CLOSED (Task 2)

Already correct: every service had a healthcheck, and `nextjs` already gated on
`service_healthy` for Postgres, Redis, MinIO and Ollama.

Fixed:

- **`worker` and `pentest-worker` did not depend on `minio`** despite both
  writing objects to it. Either could pick up a job and fail its first write
  while MinIO was still starting. Both now wait on `service_healthy`.
- **MinIO's healthcheck only opened a TCP socket**, which reports healthy while
  MinIO is still initialising its backend. It now performs a real HTTP
  `GET /minio/health/live` and requires a 200 — using only bash builtins
  (`/dev/tcp`, `printf`, `read`, `[[ ]]`), since the image has no HTTP client.

Cold-boot verified from a fully torn-down state (§8).

---

## 4. Secrets hygiene (Task 3)

### 🔴 Live secret one `git add .` away from being committed

`monitoring/secrets/grafana_cloud_api_key` contains a **real Grafana Cloud API
key** (`glc_…`, 188 bytes). It was untracked *and unignored* — `git status`
listed it. Nothing in the repo references it.

`.gitignore` now covers `monitoring/secrets/`, `**/secrets/`, `*.pem`, `*.key`.

**Decision for you:** it was never committed (verified below), so rotation is
optional — but since nothing reads it, consider deleting it outright.

### Git history is clean

Searched all history for the live Google OAuth client secret currently sitting
in `envs/.env.docker`:

```
git grep -I "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" $(git rev-list --all)  → no hits
git grep -I -n "GOCSPX-" $(git rev-list --all)                          → no hits
```

Only three env files have ever been tracked: `envs/.env.example`,
`envs/.env.docker.example`, `envs/.env.test`. **No real secret has ever been
committed.** No history rewrite is needed or recommended.

### `.gitignore` was enumerating environments by name

It listed `.env.development`, `.env.staging`, `.env.production` individually —
so a new `envs/.env.qa` or `.env.demo` would have been tracked **by default**,
the wrong way round for credential-bearing files. Now deny-by-default
(`envs/.env*`) with explicit allowances for the two templates and
`envs/.env.test`.

### `envs/.env.test` is intentionally committed — and that is fine

It carries four AES-256-GCM keys. All are throwaway test fixtures, documented
as such in-file, and CI depends on the file. Flagging it so it stays that way:
**nothing real may ever be added to it.**

---

## 5. 🔴 Backups — WERE COMPLETELY NON-FUNCTIONAL, NOW FIXED AND DRILLED (Task 4)

This is the most serious finding in the audit.

### What was wrong

The system was configured **twice, incompatibly, and both were broken**:

1. `monitoring/ofelia.ini` used `job-exec` (run inside an existing container):
   - `backup-postgres` exec'd `/scripts/backup-pg.sh` inside `dharma-postgres`
     — which mounts only `init-postgres.sql`. **No `/scripts`, no `/backups`.**
   - `backup-minio` targeted `dharma-minio-init`, a run-once container that
     `Exited (0)` seconds after boot.
2. The `backup-scheduler` compose **labels** defined a competing set of jobs
   that shelled out to `docker exec` — a binary the ofelia image does not ship
   (`which docker` → empty).
3. `save-folder = /var/log/ofelia` did not exist in the image, so every run
   also logged a `Save error` on top of its real failure.

Live evidence:

```
error creating exec: API error (409): container 776afdc54b18… is not running
Save error: "open /var/log/ofelia/…health-check.stderr.log: no such file or directory"

$ docker run --rm -v dharma_backups:/b alpine ls -la /b
total 4
drwxr-xr-x 2 root root 64 Aug 4 07:07 .      ← EMPTY
```

### And the dumps would not have restored anyway

`backup-pg.sh` piped `pg_dump --verbose 2>&1 | tee … | gzip`. `--verbose`
writes to stderr, and `2>&1` merged that progress log **into the SQL dump**:

```
=== count of pg_dump VERBOSE lines that leaked into the SQL dump ===
460
=== sample ===
pg_dump: last built-in OID is 16383
pg_dump: reading extensions
```

460 of 5,334 lines were garbage. `restore-pg.sh` runs psql with
`ON_ERROR_STOP=1`, so **every such backup would have aborted mid-restore.**

### What was done

- **Rewrote the scheduler** as `docker/backup/` — an image carrying both
  `pg_dump` (same base image as the Postgres service, so client and server
  versions can't skew) and `mc`, running `scripts/backup-all.sh` on a
  transparent sleep loop. Deleted `monitoring/ofelia.ini` and the competing
  compose labels; there is now exactly one definition.
- **Fixed the stream merge** and added integrity gates: a dump is rejected if
  it isn't valid gzip, lacks pg_dump's end-of-dump marker, or contains any
  leaked `pg_dump:` line. Verbose output goes to a sidecar `.log`.
- **Fixed a `BACKUP_DIR` collision** — both child scripts read the same var, so
  the scheduler's `BACKUP_DIR=/backups` made pg dumps land in `/backups`
  instead of `/backups/pg`, where `restore-pg.sh` globs for them.
- **Added durable outcome reporting**: `/backups/last-run.json` plus a
  `CRITICAL` log line and optional `BACKUP_ALERT_WEBHOOK_URL` POST on failure.

### 🟢 Restore drill — performed, not described

Against a **fresh** Postgres + MinIO pair on an isolated network:

```
=== fresh DB is EMPTY ===
0                                     ← tables before restore

⏳ Restoring from /backups/pg/dharma_20260804_074508.sql.gz...
✅ Restore complete.

=== RESTORED row counts (baseline was orgs=39 users=40) ===
organizations|39
users|40
controls|84
tables_total|50
=== migration state ===
21 migrations, latest: 20260803160000_phase3b_billing_webhook_idempotency_and_dunning
=== extensions ===
btree_gin, pg_trgm, plpgsql, vector

✅ MinIO restore complete.  Files : 219 restored
```

Byte-level integrity, original vs restored:

```
94f7be14d2f06585419dd896240ffd69  -   ← restored
94f7be14d2f06585419dd896240ffd69  -   ← original
```

**And the app was then booted against the restored data only:**

```
{"status":"degraded", "services":{
  "postgres":{"healthy":true,"detail":{"version":"PostgreSQL 15.4"}},
  "redis":{"healthy":true}, "minio":{"healthy":true,"detail":{"bucket":"dharma-evidence","exists":true}},
  "ollama":{"healthy":false,...}}}          ← ollama not in the drill network; expected

ORGS LOADED: 3
  - ListPair …  | sub: ACTIVE
RELATED ROWS: {"users":40,"controls":84,"frameworks":9,"policies":0}
PRESIGNED URL ISSUED: http://drill-minio:9000/dharma-evidence/org-default/reports/…pdf
EVIDENCE FETCHED: 3730 bytes; magic = "%PDF-"
```

An org loads with its relations and its evidence file is retrievable and valid.
Drill environment was torn down afterwards.

The restore procedure is documented in `README.md` → *Disaster recovery*,
written as a diagnose-then-destroy sequence for someone working under pressure.

---

## 6. CI gating (Task 5)

### 🔴 `main` had no branch protection

```
$ gh api repos/securitywithhem/Dharma/branches/main/protection
{"message":"Branch not protected","status":"404"}
```

CI ran on every push and PR and reported results — but **nothing blocked**, and
direct pushes to `main` bypassed it entirely. Configured-looking, not enforcing.

**Enabled** (per your choice of admin-bypass): required status checks `lint` and
`test`, `strict: true`, force-pushes and branch deletion blocked,
`enforce_admins: false` so you retain an emergency direct push.

### Tenant-isolation tests

They exist (`tests/phase8-tenant-isolation.test.ts`, 6 tests) and are collected
by `npm test`. Added a **separately named CI step** so they can't be lost in a
900-line log, including a `--listTests` guard so a rename or `describe.skip`
fails the build instead of silently passing.

Gate proven real, locally:

```
### BROKEN suite exit code = 1 (non-zero => CI step fails => check is red) ###
reverted.
### RESTORED suite exit code = 0 (0 => green) ###
```

I did not push a deliberately-broken test to CI, because that requires
committing, which your DoD forbids. The mechanism is proven; the enforcement
path is now real.

### 🟠 Test database collided with the dev database

`envs/.env.test` pointed `DATABASE_URL` at **`dharma_db`** — the same database
docker-compose serves for development, holding 39 orgs and 40 users. Commit
`acf75de` claims this isolation landed; in the committed file it had not. Local
`npm test` ran destructive suites against live dev data.

Repointed to `dharma_test` (matching what CI already used). This session ran on
a further-isolated `dharma_test_infra_audit`, dropped afterwards.

### 🟠 The generated Prisma client is stale

`node_modules/.prisma/client` references `Organization.paymentProvider` (169
times). **No schema and no migration in the repo defines that column** — it is
from work that hasn't landed (likely the `45ce531` provider-agnostic billing
branch). Tests failed against a freshly-pushed DB until I ran `prisma generate`.

CI is unaffected (`npm ci` → `postinstall` → `prisma generate` regenerates it),
so this is local-only drift. Flagging it because it means **your working tree
does not match your schema**, and it will bite again after any branch switch.

---

## 7. Observability & alerting (Task 6)

No Sentry/Datadog wiring existed. OpenTelemetry, Prometheus and Grafana did.

Added `src/server/lib/ops/alert.ts` — deliberately small, matching the
pre-launch, no-capital stage:

- Structured single-line JSON at `CRITICAL`/`WARN` on stdout, which compose
  already captures with rotation and Grafana can select on unchanged.
- Optional POST to `OPS_ALERT_WEBHOOK_URL` (Slack/Discord/ntfy — all free).
- Never throws: it is called from catch blocks and event handlers, where an
  alerting failure must not mask the original failure.

**On Sentry specifically:** I did not wire it. Its free tier would work, but it
needs an account and DSN this environment doesn't have, and a half-configured
SDK produces the *illusion* of monitoring. The webhook is the integration point
when that account exists. I could not verify current free-tier terms — no web
access in this session — so I am not asserting them.

### Payment webhook — the highest-priority path

`src/app/api/webhooks/stripe/route.ts` had four silent failure paths, each a
`console.warn` + a 4xx. All four now raise `CRITICAL`:

| Event | Why it matters |
|---|---|
| `billing.webhook.signature_invalid` | A rotated `STRIPE_WEBHOOK_SECRET` rejects *every* event. Stripe sees 400s, you see nothing, the customer paid and stays on Free. |
| `billing.webhook.missing_organization_id` | Money moved, entitlement didn't. |
| `billing.webhook.unknown_price_id` | Paid, but no `Plan` row maps to the price. |
| `billing.webhook.processing_error` | Valid event we failed to apply. |

### Dead-letter alerting

Attached centrally in `src/workers/index.ts` so a new worker is one line from
coverage. Distinguishes an exhausted-retries **dead letter** (`CRITICAL`) from
an intermediate retry (`WARN`), so a network blip doesn't page anyone.

While wiring it I found `startPolicyWorker()` returned a `{ close }` shim with
no event emitter, so **two queues (policy review + legacy drain) were invisible
to any failure handling**. Fixed by exposing the underlying workers.

```
🔔 Dead-letter alerting attached to 19/19 workers.
```

### Alerts proven firing, not just wired

```
--- simulating invalid Stripe webhook signature ---
{"level":"CRITICAL","event":"billing.webhook.signature_invalid",...}
>>> ALERT RECEIVED AT WEBHOOK: {"text":"[CRITICAL] billing.webhook.signature_invalid: ..."}
--- simulating a BullMQ dead-letter (attempts exhausted) ---
{"level":"CRITICAL","event":"queue.control-embedding.dead_letter","message":"Job embed-control (job-123) … failed permanently after 3 attempt(s): Ollama connection refused"}
>>> ALERT RECEIVED AT WEBHOOK: {"text":"[CRITICAL] queue.control-embedding.dead_letter: ..."}
```

Both paths reached a live HTTP receiver.

---

## 8. Test results

### Cold boot, from a fully torn-down state

```
COLD STATE CONFIRMED
 Container dharma-postgres Started / Healthy
 Container dharma-redis    Started / Healthy
 Container dharma-minio    Started / Healthy
 Container dharma-ollama   Started / Healthy
 Container dharma-minio-init Started
 Container dharma-backup-scheduler Started
 Container dharma-worker Started
 Container dharma-pentest-worker Started
```

Dependency gating held: workers started only after MinIO reported healthy.

`nextjs` initially failed to bind — **port 3000 was already held by a node
process (PID 10530) on your host**, not a compose fault. I did not kill your
process; I verified on port 3010 instead:

```
nextjs HEALTHY after 9s
{"status":"healthy","services":{
  "postgres":{"healthy":true,...},"redis":{"healthy":true,...},
  "minio":{"healthy":true,"detail":{"bucket":"dharma-evidence","exists":true}}}}
```

### Evidence round-trip on rotated credentials

```
UPLOAD  ok: infra-audit/roundtrip-1785835412872.txt
DOWNLOAD ok, matches: true
PRESIGNED: http://minio:9000/dharma-evidence/infra-audit/roundtrip-…txt
CLEANUP ok
```

### Full suite, isolated DB

```
Test Suites: 75 passed, 75 total
Tests:       551 passed, 551 total
Time:        14.25 s
```

Zero failures, including the 6 tenant-isolation tests. Run twice — before and
after the final worker changes — with identical results. `npx tsc --noEmit`
clean.

---

## 9. Mistakes I made during this audit

Recorded so they don't become someone else's mystery:

- My first MinIO healthcheck used `grep`, which **the image does not have**. My
  manual test had stopped at `head` and never reached the `grep`, so it looked
  correct. It failed the whole cold boot (`exit 127: grep: command not found`).
  Rewritten with bash builtins only and re-verified. This is exactly what the
  cold-boot requirement was for.
- A first credential-rotation pass wrote the literal string `{MINIO_ACCESS_KEY}`
  into four env files (shell expanded `$ENV` before perl saw it). Caught
  immediately, restored from backups taken beforehand, redone correctly. The
  `.pre-rotation.bak` files have since been deleted — they held the old secrets.

---

## 10. 🔵 Decision required: self-hosted vs. hosted

**Not resolved in code, per the brief.** The observation:

**The codebase currently assumes self-hosted-first**, and does so in several
places at once:

- A single `docker-compose.yml` shipping the *entire* stack — including
  Postgres, Redis, MinIO, and an 8GB-limit Ollama — as though the operator runs
  the infrastructure.
- `README.md` is titled *"Dharma – Self-Hosted Compliance Platform"*.
- Local-first inference (Ollama) rather than a hosted model API — a strong
  self-hosted signal, and expensive per-tenant in a hosted model.
- Caddy terminating TLS for a single `CADDY_DOMAIN`, not wildcard multi-tenant.

**But it is simultaneously built for hosted multi-tenancy**: Stripe billing with
plan entitlement gating, tenant isolation as a hard invariant, white-labelling,
MSSP grants, and `terraform/`, `helm/`, `k8s/` directories with staging and
production Kubernetes deploys.

So it is currently built for *both*, which is the most expensive option and is
probably not a decision anyone made deliberately. This shapes packaging,
support burden, and pricing. **It is yours to decide, and it should be decided
soon** — several of the remaining hardening choices (secrets manager vs. env
files, per-tenant vs. shared MinIO buckets, whether Ollama ships at all) fall
out of it differently depending on the answer.

---

## 11. Left for you

| # | Item | Why it's yours |
|---|---|---|
| 1 | **Self-hosted vs. hosted** (§10) | Business decision; blocks several follow-ups |
| 2 | `monitoring/secrets/grafana_cloud_api_key` | Never committed, now ignored. Nothing reads it — delete or wire it up |
| 3 | **Stale Prisma client / missing `paymentProvider`** (§6) | Your tree disagrees with your schema; likely an unlanded branch |
| 4 | Sentry | Needs an account + DSN. Alert module has the hook |
| 5 | Secrets manager (Vault/ASM) | Explicitly out of scope; depends on #1 |
| 6 | `enforce_admins: false` | You can still push directly to `main`. Flip it when comfortable |
| 7 | The Google OAuth secret in `envs/.env.docker` | Never committed, correctly ignored — but it is a *live* credential in a plaintext local file |

### Also noticed, not acted on

- A `PostToolUse` hook in this environment runs `code-review-graph update
  --quiet --skip-flows`; `--quiet` is not a valid flag, so it errored on every
  single tool call this session. Harmless but noisy — drop the flag.
- `dharma_test` (the shared test DB) has 49 tables and **no `_prisma_migrations`
  table** — built with `db push`, not migrations, so it drifts from production
  schema silently.
- A `dharma-blackbox-exporter` container was running as an orphan, defined in no
  compose file.

---

## 12. Files changed (nothing committed)

```
 M .github/workflows/deploy.yml      tenant-isolation as its own required check
 M .gitignore                        deny-by-default env + secrets + backups/
 M README.md                         disaster-recovery runbook
 M docker-compose.yml                minio healthcheck, worker deps, new backup service, ops alert env
 M envs/.env.example                 no more minioadmin; ops alerting vars
 M envs/.env.test                    dharma_test, not the dev database
 D monitoring/ofelia.ini             superseded by docker/backup/
 M scripts/backup-all.sh             per-tool BACKUP_DIR namespacing
 M scripts/backup-pg.sh              stream-merge fix + integrity gates
 M src/app/api/webhooks/stripe/route.ts   CRITICAL alerts on 4 silent paths
 M src/env.ts                        production placeholder guard
 M src/lib/storage/minioClient.ts    credentials from env.ts
 M src/server/minio.ts               credentials from env.ts
 M src/workers/index.ts              central dead-letter alerting
 M src/workers/policy.ts             expose underlying workers
?? docker/backup/                    new backup runner image + scheduler
?? src/server/lib/ops/               new ops alerting module
```

Live environment changes made outside the repo:
- MinIO root credentials rotated (data intact, verified).
- Branch protection enabled on `main` (`lint` + `test` required, admin bypass).
