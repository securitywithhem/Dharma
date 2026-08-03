# Phase 3c — Razorpay as the live payment provider

**Date:** 2026-08-03
**Scope:** Make Razorpay the active, sellable payment provider, without deleting
Stripe, and without rewriting anything above the provider boundary.
**Status:** Server, workers, schema and UI complete; 661 tests passing;
`tsc --noEmit` clean. **NOT signed off** — the live Razorpay Test Mode E2E cycle
has not been run (see "Outstanding").

---

## Why

Stripe is invite-only for India-based accounts and cannot be activated for real
sales. The Phase 3b billing work (entitlements, audit trail, idempotency,
reconciliation, dunning) is provider-independent and was worth keeping intact.

## Context corrections to the task brief

Verified against live code before any change. The brief's assumptions that did
not hold:

- **`prisma/schema.prisma` does not exist.** The schema is at
  `packages/db/schema.prisma`.
- **`envs/` does exist** (the brief was right), but there is no `.env` under
  `prisma/` and migrations live in `packages/db/migrations/`.
- The brief described a `ProcessedWebhookEvent`-style model "per prior session's
  report" — it exists exactly as described, with `eventId @unique`.
- `claude/fixes-2026-08-03-billing.md` exists and its claims all checked out
  against live code.
- **The test suite could not be baselined at the start.** A jest run left over
  from a previous session had been hung for 2h51m (14s CPU) holding the test
  database; a fresh run deadlocked behind it. Both were killed and the suite ran
  clean afterwards. The pre-change baseline is therefore the *documented* 611
  from Phase 3b, not an independently re-measured number.

## Architecture

`src/server/services/payments/provider.ts` defines `PaymentProviderAdapter`.
The method set was derived from the real pre-existing call sites, not designed
up front. `StripeProvider` wraps the existing `src/lib/stripe.ts` unchanged;
`RazorpayProvider` is new. `getPaymentProvider()` resolves the deployment
default from `PAYMENT_PROVIDER` (defaulting to **razorpay** — an unset variable
must not land on the provider that cannot be activated).

`providerFor(org)` is separate from `getPaymentProvider()` and this matters: an
org that subscribed through Stripe keeps being reconciled, dunned and cancelled
through Stripe. Routing its cancellation through the active provider would look
up a Stripe subscription ID in Razorpay, fail, and leave a customer billed for a
plan they cancelled.

`src/server/services/billing/lifecycle.ts` is new and holds every webhook-driven
state change — plan application, downgrade, dunning clock, idempotency claim,
audit write — once, for both providers. The Stripe route was reduced to a
translator over it (behaviour unchanged), so a fix can no longer apply to one
provider and not the other.

## Two genuine differences from Stripe, modelled rather than hidden

1. **Checkout shape.** Stripe redirects to a hosted page; Razorpay creates the
   subscription server-side and the browser opens Checkout.js as an in-page
   modal. `createCheckoutSession` returns a discriminated `CheckoutHandoff`
   (`kind: 'redirect' | 'modal'`). Collapsing these into `{ url }` would have
   produced an upgrade button that navigates nowhere.
2. **No hosted portal.** Razorpay has no Billing Portal equivalent, so
   `createPortalSession` returns `null` (meaning "no portal", not "error") and
   Dharma ships its own management screen. The old "Manage billing" button would
   otherwise have opened nothing.

## The three Stripe bug classes, re-checked in the new adapter

- **Metadata propagation.** The Stripe bug was metadata on the Checkout Session,
  which Stripe does not propagate to the Subscription. The trap does not exist
  here for a structural reason: this adapter creates the Subscription itself, so
  `notes` sit on the object the webhook delivers. Asserted by test, not assumed
  (`metadata propagation (regression: Stripe bug #1)`).
- **Idempotency.** `x-razorpay-event-id` is the dedupe key (Razorpay retries
  with exponential backoff for 24h on any non-2xx or any response slower than
  5s). If that header is ever absent the receiver deduplicates on a SHA-256 of
  the signed bytes rather than silently dropping idempotency. The claim is taken
  inside the same transaction as the state change.
- **Unverified org ID → 500 → infinite retry.** `resolveOrganizationId`
  existence-checks the metadata ID, then falls back to the provider customer ID,
  then to a known subscription ID. Tested for 200-not-500 on an unknown org.

Additionally, `ProcessedWebhookEvent` gained a `provider` discriminator and its
unique moved from `eventId` to `(provider, eventId)`, so two providers can never
collide in the dedupe lock.

## Notable decisions

- **`paymentProvider` is nullable, not defaulted.** An org that has never paid
  has no provider; stamping one would make the reconciliation and dunning
  workers scan free orgs against an API that has never heard of them. Existing
  Stripe-linked rows were backfilled to `STRIPE` in the migration.
- **Razorpay status mapping is not a transliteration of Stripe's.** `created`
  and `authenticated` mean the mandate exists but no money has moved, so they
  map to `PAST_DUE`, not `ACTIVE` — mapping them to ACTIVE would hand out paid
  entitlements before any payment. `halted` stays `PAST_DUE` because
  termination is the dunning sweep's decision alone, matching the Stripe path.
- **`Plan.currency` was added.** Razorpay India sells in INR while the existing
  prices were authored in USD. Without it the UI renders "$999" for a
  rupee-denominated plan, which misstates a price to a paying customer.
- **`confirmCheckout` is a UX fast path, not an access grant.** It verifies
  Razorpay's own HMAC (`payment_id|subscription_id` under the key secret),
  checks the subscription belongs to the caller's org, then **re-fetches the
  subscription from Razorpay** and applies the plan from that server-side read.
  A forged callback fails the HMAC; a callback that passes it still cannot name
  its own plan. The webhook remains the source of truth.
- **Dunning policy untouched.** 14 days, clocked from the first failure only,
  re-checked before downgrade, skipped rather than guessed when the provider is
  unreachable. Only the status re-check became provider-aware. The
  gone-vs-unreachable distinction is now an explicit adapter contract
  (`null` = confirmed gone, `ProviderUnreachableError` = could not find out),
  because conflating them either cuts off a paying customer over a network blip
  or lets a cancelled org keep paid access forever.
- **`razorpayPreviousSubscriptionId` was added** for payment-method updates.
  Razorpay binds the mandate to the subscription, so changing a card means
  authorising a new subscription and cancelling the old one. The old ID is held
  server-side rather than round-tripped through the browser — a client-supplied
  cancellation target is an ID an attacker gets to choose.

## Migration

`packages/db/migrations/20260803180000_phase3c_razorpay_provider_agnostic_billing`.
Hand-written for the same reason as Phase 3b's (`prisma migrate diff` also emits
a `DROP INDEX "Control_path_gin_idx"` that would de-optimise control-tree
queries). Strictly additive for data: no column dropped or renamed, Stripe
columns untouched. The one index dropped (`ProcessedWebhookEvent_eventId_key`)
is replaced in the same migration by a strictly stronger composite.

## Tests

```
tests/billing.razorpay.provider.test.ts   30 passed
tests/billing.razorpay.webhook.test.ts    20 passed

# Full suite:
Test Suites: 86 passed, 86 total
Tests:       661 passed, 661 total
```

661 = the documented 611 plus exactly these 50, so no existing test regressed —
including the Stripe suite, which still passes against the refactored route.

**The suite had to be run against a separate database** (`dharma_test_rzp`,
created with `prisma db push`). Another Claude Code session was concurrently
running `jest --runInBand` against `dharma_test`; two such runs deadlock each
other on the shared Postgres, which is what hung every earlier attempt for
20-170 minutes at ~15s CPU. Command used:

```
npx dotenv -e envs/.env.test -- env DATABASE_URL=…/dharma_test_rzp npx jest --runInBand
```

Note `dotenv -e` overrides an exported DATABASE_URL, so the override must come
*after* it via `env`. Worth knowing for any future parallel session.

Razorpay signatures are **real**, not mocked: the scheme is a plain HMAC-SHA256
of the raw body, so correct and tampered signatures are produced offline with an
arbitrary secret. Covered: missing header, wrong secret, post-signing tamper
(with a DB assertion that nothing was written), no error-text leakage, and
not-configured reported rather than silently accepted.

## Outstanding — required before this phase can be called done

No Razorpay account exists yet, so none of the following could be run. **The
code passing offline tests is necessary but not sufficient**, exactly as was
true for the original Stripe work.

- [ ] Real Test Mode keys (`rzp_test_…`, zero KYC) in `envs/.env.development`.
- [ ] Real Razorpay Plans created; IDs into `RAZORPAY_PLAN_PRO` /
      `RAZORPAY_PLAN_ENTERPRISE`; `npm run seed:plans` re-run with
      `BILLING_CURRENCY=INR` and real INR amounts.
- [ ] Live E2E: Plans → Select → Checkout.js modal → test card → webhook
      received → plan upgraded → AuditLog written → invoice visible.
- [ ] Live E2E: Manage → Cancel → downgrade to Free → Free limits re-apply.
- [ ] Live E2E: failed payment → dunning notify → 14-day grace → sweep.
- [ ] **Live E2E: payment-method update.** Highest-risk untested path. It
      creates a replacement subscription and cancels the old one *after* the new
      one is confirmed. If the cancel fails, a duplicate mandate can bill the
      customer twice — the code logs this loudly and leaves the record for
      retry, but the flow must be verified against Test Mode before real sales.
- [ ] Playwright assertion that `checkout.razorpay.com` is not requested off the
      Billing route (the lazy-load is in place and verified by reading; not
      asserted in CI).

## Known future item — GST invoicing

Razorpay handles GST on its own fees. Whether Dharma must issue GST-compliant
invoices to its own customers depends on its revenue and registration status —
a business/tax question, not a code one. A validated optional `gstin` field is
collected on the Manage screen as a forward-compatible placeholder; **no GST
invoicing engine was built**, deliberately.
