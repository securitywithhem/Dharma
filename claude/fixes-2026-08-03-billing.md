# Phase 3b — Billing & Subscription lifecycle

> **Superseded in part by Phase 3c (Razorpay / provider-agnostic billing),** which
> landed on top of this work. Every defect and behaviour described below still holds,
> but several seams moved: the webhook state changes now live in
> `src/server/services/billing/lifecycle.ts` (shared by both receivers), provider calls
> go through `src/server/services/payments/*` adapters rather than the Stripe SDK, and
> `ProcessedWebhookEvent` is now keyed on `(provider, eventId)`. `tests/billing.dunning.test.ts`
> was re-pointed at the provider boundary accordingly. Read this doc for *why* each
> behaviour exists; read the 3c files for where it now lives.

**Date:** 2026-08-03
**Scope:** Complete the billing lifecycle on top of the existing partial implementation.
**Status:** Server-side complete and unit/integration tested. **NOT signed off** — the
live Stripe test-mode cycle has not been run (see "Outstanding" below).

---

## Context correction

The task brief asked for `1_PRD.md`, `2_TRD.md`, `3_APP_FLOW.md`, `5_BACKEND_SCHEMA.md`,
`6_IMPLEMENTATION_PLAN.md`, `claude/launch-audit-2026-08-02.md`, and
`claude/qa-report-2026-08-03.md`. **None of these files exist in the repo.** Specs live in
`Dharma-Knowledge-OS/`; the nearest real audit artifact is `LAUNCH_READINESS_REPORT.md`
(2026-08-02). Work below was therefore verified against live code, not those documents.

Two brief items were **already fixed** before this session and were left alone:

- launch-audit P1 (Stripe.js loading globally) — fixed in `1492ba5`. `StripeProvider` is
  unmounted from `src/app/providers.tsx` and `loadStripe()` is lazy.
- qa-report §3.7 (empty "Features Included" on Free) — already renders plan allowances
  from `plan.limits`, with a comment explaining why positive keys were *not* added to
  `features` (that map gates entitlements; padding it to improve copy would change access).

---

## Defects found and fixed

### 1. Checkout metadata never reached the Subscription — plans never applied (critical)

`createCheckoutSession` set `metadata.organizationId` on the **Checkout Session** only.
Stripe does not propagate session metadata to the Subscription it creates, so every
`customer.subscription.*` webhook arrived with no `organizationId`, hit the
`No organizationId` branch, and returned 400. **The result: a customer could pay and never
be upgraded**, while Stripe retried the event to exhaustion.

Fixed in `src/lib/stripe.ts` by adding `subscription_data.metadata.organizationId`.

### 2. Webhook had no idempotency

Stripe delivers at least once and redelivers on timeout or manual resend. A redelivered
event re-ran the plan write and emitted a **second AuditEvent** — corrupting the audit
trail the product sells.

Added `ProcessedWebhookEvent` (migration
`20260803160000_phase3b_billing_webhook_idempotency_and_dunning`). The unique constraint on
`eventId` is the dedupe lock, and the claim is taken *inside* the same transaction as the
state change, so a mid-handler failure rolls the claim back and Stripe's retry gets a real
second attempt. Chose a table over a Redis TTL key deliberately: the audit trail is what is
being protected, so the dedupe record must be as durable as the rows it guards.

### 3. Webhook wrote no AuditEvents

None of the four handled events produced an audit entry. All state changes now emit via
`emitAuditEvent`: `BILLING_CHECKOUT_COMPLETED`, `BILLING_PLAN_UPDATED`,
`BILLING_SUBSCRIPTION_CANCELED`, `BILLING_PAYMENT_FAILED`, `BILLING_PAYMENT_RECOVERED`,
plus `BILLING_DOWNGRADED_FOR_NONPAYMENT` and `BILLING_RECONCILED` from the workers, and
`BILLING_CHECKOUT_STARTED` / `BILLING_PLAN_UPDATED` / `BILLING_SUBSCRIPTION_CANCELED`
(source: `user`) from the tRPC mutations.

### 4. Wrong retry signalling

Permanently unprocessable events (unknown org, unseeded price) returned 400/500, putting
Stripe into a multi-day retry loop that could never succeed. These now log loudly and
return 200; only genuinely transient faults return 500.

### 5. `metadata.organizationId` was trusted without an existence check

Caught by a test that asserted 200 for an unknown org and got 500: the resolver passed the
unverified ID straight to `organization.update`, which throws. `resolveOrganizationId` now
existence-checks the metadata ID and falls back to `stripeCustomerId` lookup — which also
fixes portal/dashboard-initiated changes that carry no Dharma metadata.

### 6. Billing History displayed fabricated financial records

`BillingHistory.tsx` rendered a hard-coded `Invoice #INV-001 / $99.00 / today` row whenever
a subscription was active, with a Download button wired to nothing, plus a "Subscription
Created" timeline entry dated to page load, and a "Manage Payment Methods" button with no
handler. In a compliance product, invented invoices are worse than an empty state. Replaced
with real Stripe data via `billing.listInvoices`; the invented timeline card was removed
(the real history is the audit log); the portal button is wired.

### 7. `alert()` used for post-checkout feedback

Replaced with the app's `sonner` toasts. The success copy no longer claims the plan *has*
updated — the webhook may land after the redirect — and now invalidates the billing queries
so the UI reflects the real state when it arrives.

---

## Added

**tRPC** (`src/server/routers/billing.ts`): `getUsage`, `createBillingPortalSession`,
`listInvoices`. All tenant-scoped off `ctx.session.user.organizationId`; the Stripe customer
is never accepted from the client.

**Webhook** (`src/app/api/webhooks/stripe/route.ts`): added `checkout.session.completed`
and `invoice.payment_succeeded` (clears the dunning clock) to the existing three.

**Workers:**
- `billing-reconciliation` (daily 04:00) — treats Stripe as source of truth, self-heals plan
  and status drift, downgrades orgs whose subscription vanished at Stripe, audits every
  correction, and prunes the webhook ledger (30-day retention). A run with corrections is
  also the signal that webhook delivery itself is broken.
- `dunning-notification` — `notify` on payment failure (emails org ADMINs; note this schema
  has no OWNER role), plus a daily 03:00 `sweep` that downgrades after the grace period.

**Dunning policy (product-owner decision, 2026-08-03): 14 days.** Chosen to sit just past
Stripe's default Smart Retries schedule so we never downgrade while Stripe is still trying
to collect. The clock is set on the *first* failure only — restarting it per retry would make
the grace period unbounded. Before any downgrade the sweep re-checks Stripe and will clear
delinquency instead if the subscription recovered; if Stripe is unreachable it **skips**
rather than guessing, because wrongly cutting off a paying customer is the worse error.

---

## Tests — all passing

```
tests/billing.webhook.test.ts       9 passed
tests/billing.entitlement.test.ts   6 passed
tests/billing.dunning.test.ts       7 passed
Tests: 22 passed, 22 total

# Full suite (npm test → dotenv -e envs/.env.test -- jest --runInBand):
Test Suites: 84 passed, 84 total
Tests:       611 passed, 611 total
```

611 = the prior 589 plus exactly these 22, so no existing test regressed.
`npx tsc --noEmit` reports 0 errors.

### Pre-existing: `npm test` never terminates (CI hazard, NOT introduced here)

The suite completes in ~15s and reports all-green, then the jest process hangs forever:

```
Tests:       611 passed, 611 total
Ran all test suites.
Jest did not exit one second after the test run has completed.
```

Any runner with a timeout kills it and records a **failure despite every test passing** —
which is exactly how this surfaced (two background runs reported exit 1 on an all-green
summary). In CI this means `npm test` hangs until the job timeout and never reports green.

**Verified pre-existing:** running the suite with the three `tests/billing.*` files excluded
(81 suites / 589 tests — the pre-Phase-3b baseline) hangs identically. Not caused by this work.

**Cause:** nine queue modules construct their BullMQ `Queue` at module scope, so merely
importing one opens a Redis connection that nothing ever closes —
`aiIngestionQueue`, `connectorQueue`, `evidenceAutoTagQueue`, `controlEmbeddingQueue`,
`pentestScanQueue`, `readinessScoreQueue`, `siemExportQueue` (×2), `webhookQueue`.

**Fix pattern (already used by the two queues added here):** construct lazily behind a
getter — see `getDunningQueue()` in `src/server/queue/dunningQueue.ts` and
`getBillingReconciliationQueue()`. Importing those opens nothing. Converting the other nine
is a small mechanical change, deliberately left out of this diff because it touches files
outside billing that other in-flight work is editing. `--detectOpenHandles` will confirm.

**Gotcha worth knowing:** running bare `npx jest` bypasses the dotenv wrapper and
points at the *development* database, producing ~55 spurious failures. Only `npm test`
loads `envs/.env.test`. Additionally, the test DB is managed with `prisma db push`, not
migration history — `migrate deploy` against it fails with P3005, so new migrations must
be pushed there separately.

Signature verification is tested against **real** signatures via Stripe's
`webhooks.generateTestHeaderString`, which signs offline with an arbitrary secret — this
exercises the actual verification path with no Stripe account. Covered: missing header,
wrong secret, post-signing tamper (with a DB assertion that nothing was written), and no
error-text leakage. Idempotency: replaying one event ID leaves exactly one state change,
one AuditLog row, and one ledger row.

**Testing-infrastructure note for future sessions:** this repo transforms tests with SWC via
`next/jest`, which only hoists `jest.mock()` above imports when `jest` is the *global*. Tests
here import `jest` from `@jest/globals`, so `jest.mock()` runs in source order — after a
static import has already loaded the real module. A static `import stripe from "@/lib/stripe"`
in a test does not merely skip the stub, it lets the suite make **live Stripe API calls**
(observed during this work). Mocked modules must be pulled in with a dynamic `await import()`
inside `beforeAll`. Both `billing.webhook.test.ts` and `billing.dunning.test.ts` document this
inline.

---

## Outstanding — required before this phase can be called done

All Stripe credentials in `envs/.env.development` are placeholders (`sk_test_YOUR…`,
`prod_test_pro`) and the Stripe CLI is not installed, so none of the following could be run:

- [ ] Create real Pro/Enterprise **Prices** in Stripe test mode; put the `price_…` IDs into
      `STRIPE_PRODUCT_PRO` / `STRIPE_PRODUCT_ENTERPRISE` and re-run `npm run seed:plans`.
      (Note the env var names say PRODUCT but the code correctly expects a *price* ID.)
- [ ] Live E2E: Billing → Checkout (`4242 4242 4242 4242`) → return → plan updated, invoice
      visible, AuditEvent written.
- [ ] Live E2E: `stripe trigger customer.subscription.deleted` → org downgrades to Free and
      the Free limits re-apply.
- [ ] Full manual upgrade → downgrade → cancel cycle verified against both DB and UI.
- [ ] Playwright network assertion that `js.stripe.com` is not requested off the Billing
      route (the code fix is in place and verified by reading; not asserted in CI).

README §5 now documents the full local Stripe setup so this is reproducible.
