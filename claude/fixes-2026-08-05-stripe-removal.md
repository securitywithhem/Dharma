# Stripe removal — Razorpay becomes the sole payment provider

**Date:** 2026-08-05
**Scope:** Remove Stripe from code, schema, config, docs and tests. Collapse the
Phase 3c provider abstraction to direct Razorpay calls.
**Status:** Complete offline. **NOT signed off for real sales** — the live
Razorpay Test Mode E2E cycle has still not been run (see "Outstanding").

---

## Step 0 — the discrepancy, resolved

The brief described two contradictory prior sessions: one reporting a working
Razorpay integration, one auditing the repo and finding only Stripe. Both were
right about what they could see.

**Local `main` was 16 commits behind `origin/main`.** The infra-audit session ran
against that stale checkout, which predates the Razorpay merge.

| Check | Result |
|---|---|
| `git log --all --oneline \| grep -i razorpay` | **no match** — the commit subject says "provider-agnostic", not "razorpay". This is why the brief's own grep missed it. |
| `git grep -il razorpay $(git rev-list --all)` | 21 files at `d841a6e` |
| `git rev-list --left-right --count main...Hem` | `0  16` — strict ancestor, fast-forwardable |
| `git stash list` | empty |
| Other worktree (`Compilo.worktrees/agents-run-entire-project`) | unrelated workers refactor, no Razorpay |

The work was `45ce531 feat(billing): complete the Phase 3b lifecycle and make
payments provider-agnostic (3c)`, merged to `origin/main` via PR #18.

**Case: recover, not rebuild.** Nothing was rewritten from scratch.

### Reconciling the two lines of work

The working tree also held uncommitted infra-audit changes (ops alerting, a
production placeholder-secret guard, MinIO hardening, a containerised backup
scheduler) overlapping 8 files with the incoming commits. Committed as `8e3bd7c`
first, then merged (`af47395`), so neither line was silently lost.

Conflict resolutions worth knowing:

- **`src/workers/index.ts`** — kept both sides. The incoming dunning and billing
  reconciliation workers are now also registered for dead-letter alerting. They
  are the highest-consequence workers to fail silently: a dead-lettered dunning
  job leaves a delinquent org on a paid plan forever.
- **`src/app/api/webhooks/stripe/route.ts`** — took `origin/main`. That side had
  rewritten the route as a thin translator over `lifecycle.ts`, so the audit
  side's inline `opsAlert` calls no longer had the code they annotated. Since
  the file was being deleted anyway, resolving line-by-line would have been
  wasted work. **This left a real gap — see "Carried-over work not done".**

---

## Task 1 — the Razorpay integration was verified BEFORE anything was deleted

All nine checklist items confirmed against live code, not against the prior
session's report. Highlights:

- `mapRazorpayStatus` maps `created` and `authenticated` to **`PAST_DUE`**, not
  `ACTIVE` — the mandate exists but no money has moved. Mapping these to ACTIVE
  grants paid entitlements before any payment.
- `confirmCheckout` verifies the HMAC (`payment_id|subscription_id`), checks
  `org.razorpaySubscriptionId === input.razorpaySubscriptionId` for tenant
  isolation, then **re-fetches from Razorpay** and applies the plan from that
  server-side read. A forged callback fails the HMAC; one that passes still
  cannot name its own plan.
- Payment-method update cancels the old mandate **only after** the replacement
  is confirmed applied, and on cancel failure logs
  `DUPLICATE MANDATE MAY BE ACTIVE` at error level while deliberately leaving
  `razorpayPreviousSubscriptionId` un-nulled so the cancel can be retried.
- Webhook idempotency claim is taken inside the same transaction as the state
  change; `resolveOrganizationId` existence-checks the notes ID then falls back
  to customer ID then subscription ID.
- Checkout.js is loaded lazily and billing-scoped (`useRazorpayCheckout`), not
  app-wide.

**Baseline before any deletion: 661 tests passing, 86 suites, `tsc --noEmit`
clean.** This matches the prior session's claim exactly.

---

## What was removed

**Deleted:** `src/lib/stripe.ts`, `src/server/services/payments/stripeProvider.ts`,
`src/components/billing/StripeProvider.tsx`, `src/app/api/webhooks/stripe/route.ts`,
`tests/billing.webhook.test.ts`. Packages `stripe`, `@stripe/stripe-js`,
`@stripe/react-stripe-js` uninstalled.

**Abstraction collapsed.** `getPaymentProvider()`, `providerFor(org)`,
`providerByEnum()`, `activeProviderName()`, the `PaymentProviderAdapter`
interface, the `ProviderName` union, `PROVIDER_ENUM` and the `PAYMENT_PROVIDER`
env switch are all gone. `provider.ts` was renamed to `types.ts` and keeps only
the normalisation types — those earned their keep independently of there being
two providers, and survive unchanged if a second one is ever added.

Two procedures were deleted rather than left throwing: `createBillingPortalSession`
and `RazorpayProvider.createPortalSession`. With one provider that has no hosted
portal, they could only ever fail — a dead code path, which is what this task
exists to remove.

**Schema** (`20260805120000_remove_stripe_single_provider_razorpay`): dropped
`Organization.stripeCustomerId`, `.stripeSubscriptionId`, `.paymentProvider`;
`Plan.stripePriceId`; `ProcessedWebhookEvent.provider`; and the
`PaymentProvider` enum type. The dedupe unique collapsed from
`(provider, eventId)` back to `eventId` — with one provider there is no second
namespace to collide with.

---

## Judgement calls worth reviewing

**1. The migration refuses to run if real Stripe data exists.** Verified
0 of 39 organizations carried a Stripe identifier, and `Plan.stripePriceId` held
only placeholder seed values (`prod_test_pro` — not even a well-formed Stripe
price ID). Rather than record that in a comment, the migration opens with a
`DO $$ ... RAISE EXCEPTION` guard that aborts if any org still has Stripe
linkage. A claim in a comment does not protect a database that is not the one
that was checked.

**2. Plan currency was deliberately NOT flipped from USD to INR.** The column
default is now `INR`, but **existing rows were left alone**. Their `price`
values (99, 999) were authored as USD amounts; setting `currency = 'INR'`
without converting the amount would render "₹99" for a plan priced at $99 —
misstating a price to a paying customer, which is the exact bug `Plan.currency`
was added to prevent. Re-seed with real INR amounts instead:

```bash
BILLING_CURRENCY=INR BILLING_PRICE_PRO=… BILLING_PRICE_ENTERPRISE=… npm run seed:plans
```

**This is an outstanding action before selling anything.** The dev database
still shows `pro / 99 / USD`.

**3. The audit `provider` discriminator was removed, per the brief's guidance.**
`BILLING_PLAN_UPDATED` entries no longer carry `provider: 'razorpay'` — a field
with one possible value. The test that asserted it now asserts what actually
makes a plan change explainable after the fact: the causing `eventId`, the raw
`providerStatus`, and the target plan.

**4. Historical migrations and reports were not rewritten.** The phase3b/3c/4
migration SQL files and `LAUNCH_READINESS_REPORT.md` still contain the word
"Stripe". They are applied history and a dated record; editing migration SQL
breaks Prisma's checksums, and editing a dated report falsifies it. One
intentional reference remains in code — the rationale comment in
`src/server/services/payments/index.ts` explaining why there is no abstraction,
which is the codebase's own "document why you deviate" convention.

---

## An unrelated bug this surfaced, and fixed

The first production build failed — **not from the Stripe removal**:

```
Error: Refusing to start in production with shipped placeholder secrets:
ANCHOR_STORAGE_ACCESS_KEY, ANCHOR_STORAGE_SECRET_KEY
```

That guard is the infra-audit session's own work (`8e3bd7c`, `src/env.ts`).
`next build` evaluates route modules to collect page data with `NODE_ENV`
already `production`, so the guard fired during **compilation** and made the
Docker image unbuildable. `envs/.env.production` does not set `ANCHOR_STORAGE_*`,
so the schema default `minioadmin` was what it caught — correctly, but at the
wrong moment.

Fixed narrowly: the assertion now returns early when
`NEXT_PHASE === "phase-production-build"`. A build is not a boot; the build host
legitimately has no production secrets. The check that matters still runs when
the built server starts, where a placeholder is a real incident. Without this,
**no production image could be built at all** — worth knowing independently of
this task.

---

## Carried-over work — RESOLVED 2026-08-05

The merge resolution took `origin/main`'s version of the Stripe webhook route,
which discarded the infra-audit session's `opsAlert` calls. **This has now been
restored on the Razorpay route**, matching the Stripe naming convention:

| Event | Severity | Fires when |
|---|---|---|
| `billing.webhook.signature_invalid` | CRITICAL | any verification failure (`invalid-signature`, `missing-signature`, `not-configured`) |
| `billing.webhook.missing_organization_id` | CRITICAL | org unresolvable after notes → customer → subscription fallback (3 sites: activation, cancellation, payment failure) |
| `billing.webhook.unknown_plan_id` | CRITICAL | no local `Plan` row matches the Razorpay plan (renamed from Stripe's `unknown_price_id`) |
| `billing.webhook.processing_error` | CRITICAL | a verified event threw while being applied |

Verified end-to-end against a live HTTP receiver (not just "the code path ran"),
all four delivered. Two defects were found and fixed during that verification:

1. **Prisma dumped ~2KB of minified bundle source into the alert message.** In a
   production build `err.message` embeds the failing call site. `alertSafeReason()`
   now keeps only Prisma's first line (the operation) and last line (the actual
   cause — "Server has closed the connection."), capped at 300 chars. The raw
   error still goes to `logger.error` on stdout.
2. **`envs/.env.docker` had NO Razorpay configuration at all.** Every webhook
   delivery to the containerised stack was rejected `500 not configured` before
   any signature check. Added there and to `.env.docker.example`.

---

## Verification

| Check | Result |
|---|---|
| `grep -rli stripe src/ envs/ tests/ packages/db/schema.prisma docker-compose.yml package.json` | 1 file — the intentional rationale comment |
| `npx tsc --noEmit` | clean |
| Full suite (isolated `dharma_test_rzp`) | **649 passed, 85 suites, 0 failed** |
| Migration on a from-scratch DB | full 24-migration chain applies cleanly |
| Migration on dev DB | 39 orgs preserved, 0 Stripe columns remain |
| `next lint` | no new warnings |
| `next build` (production) | succeeds; only `/api/webhooks/razorpay` in the route table, no `js.stripe.com` in any client chunk |
| Cold boot (`docker compose down && up`, images rebuilt) | **all 15 containers healthy**; `GET /` → 200, `POST /api/webhooks/razorpay` → 400 (correctly rejecting an unsigned body), `POST /api/webhooks/stripe` → **404** |
| Worker boot | `Dead-letter alerting attached to 21/21 workers`, including both billing workers |

The delta 661 → 649 is exactly the 12 tests in the deleted Stripe suite. Its
coverage was checked item by item against the Razorpay suites before deletion;
the one genuine gap — "records exactly one ledger row per event ID" — was
recovered as a new test, replacing the cross-provider collision test that the
schema change made meaningless.

The suite takes **~14 seconds**. An earlier 20-minute stall was a post-run
open-handle hang, not slow tests; `--forceExit` avoids it. This is the same
pathology the Phase 3c session hit as a 2h51m hung jest holding the test DB.

### Test database isolation

Ran against a session-specific `dharma_test_rzp`, not the shared `dharma_test`,
per this project's established practice of avoiding concurrent-session DB
collisions. `envs/.env.test.session` is a local artifact — **delete it**, it is
not meant to be committed.

---

## Outstanding

1. **Live Razorpay Test Mode E2E cycle has NOT been run.** No Test Mode keys were
   available in this session. Offline tests are necessary but not sufficient for
   payments code — checkout → webhook → plan upgrade must be exercised end to end
   against real Razorpay before this is safe to sell through.
2. **Billing webhook ops alerting** — see "Carried-over work" above.
3. **Plan prices are still USD-authored amounts.** Re-seed with real INR values.
4. `RAZORPAY_PLAN_PRO` / `RAZORPAY_PLAN_ENTERPRISE` are unset in the dev env, so
   no plan is currently sellable (`isSellable` correctly returns false).
5. A stale 23-hour-old `npm run dev` server was holding port 3000 and was
   stopped so the containerised cold boot could bind. A fresh `next dev` was
   running again by the end of the session, so the cold boot was verified on
   `NEXTJS_PORT=3100` rather than killing it a second time. `envs/.env.docker`
   still says 3000 — the override was CLI-only and nothing needs reverting.
6. Nothing was committed beyond the two reconciliation commits (`8e3bd7c`,
   `af47395`) needed to merge the branches. The removal itself is staged in the
   working tree, uncommitted, per this project's convention.
