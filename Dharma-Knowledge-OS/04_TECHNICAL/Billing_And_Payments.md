---
title: Billing and Payments
folder: 04_TECHNICAL
tags: [dharma, technical, billing, payments, entitlements]
source_docs: [packages/db/schema.prisma, src/server/services/payments/, src/server/services/billing/lifecycle.ts, src/server/routers/billing.ts, claude/fixes-2026-08-03-billing.md, claude/fixes-2026-08-03-razorpay-migration.md]
last_updated: 2026-08-04
status: reviewed
---

# Billing and Payments

Phase 3b (billing lifecycle) and Phase 3c (provider-agnostic payments) shipped on 2026-08-03 and had no vault node until this audit. Everything below is transcribed from live code.

## Why there are two providers

Stripe is invite-only for India-based accounts and cannot be activated for real sales, so **Razorpay is the live provider**. Stripe was not deleted — it stays a legitimate route for international customers. Rather than swapping SDKs, everything above the provider boundary (the tRPC router, both workers, entitlements, the audit trail) talks to one interface and never to a vendor SDK.

## The provider boundary

`src/server/services/payments/provider.ts` defines the interface; `stripeProvider.ts` and `razorpayProvider.ts` implement it; `index.ts` selects one. The method set was derived from the call sites that already existed before the migration, not designed up front: checkout, portal, invoices, update, cancel, retrieve, and webhook signature verification.

Provider quirks are normalised behind `NormalizedSubscription` — statuses mapped onto Dharma's own `SubscriptionStatus` enum, Unix seconds turned into `Date`s, the plan/price identifier surfaced under one name — so no caller branches on the provider name.

**One difference is modelled explicitly rather than normalised**: Stripe redirects to a hosted checkout page, Razorpay opens an in-page modal. That is expressed as a `CheckoutHandoff` union, because pretending Razorpay returns a redirect URL would produce a checkout flow that silently does nothing. The client half is `src/components/billing/useRazorpayCheckout.ts`.

## Webhook idempotency

Both receivers (`src/app/api/webhooks/{stripe,razorpay}/route.ts`) share the state machine in `src/server/services/billing/lifecycle.ts` (`applyCheckoutCompleted`, `applySubscriptionState`, `applySubscriptionCanceled`, `applyPaymentFailed`, `applyPaymentRecovered`).

Dedupe is the `ProcessedWebhookEvent` table, unique on `(provider, eventId)`. Two decisions worth preserving:

- **A table, not a Redis TTL key.** What is being protected is the audit trail, so the dedupe record must be as durable as the rows it guards. A redelivered event that re-ran the plan write would emit a second `AuditLog` entry — corrupting the thing this product sells.
- **The claim is taken inside the same transaction as the state change.** A mid-handler failure rolls the claim back, so the provider's retry gets a real second attempt rather than being swallowed as a duplicate.

The composite key exists because event IDs are only unique within a provider's namespace, and Razorpay events carry no ID at all — the receiver synthesises one.

## Dunning and reconciliation

Two daily repeatable BullMQ jobs, both registered with fixed job IDs so re-registration is idempotent:

- **`dunning-sweep`** (`0 3 * * *`) — acts on organizations whose grace period has expired. The policy is **14 days, provider-independent**, clocked from `Organization.dunningStartedAt`, which is set on the *first* failed invoice and cleared on any success. Clocking from the first failure rather than the latest is deliberate: providers retry a failed invoice several times, and restarting the clock on each retry would make the grace period unbounded.
- **`billing-reconciliation`** (`0 4 * * *`) — re-reads subscription state from the provider and corrects local drift, for the case where a webhook was lost entirely.

Both skip organizations with a null `Organization.paymentProvider` — free orgs have no provider, and scanning them would query an API that knows nothing about them.

## Entitlements

`src/server/services/entitlement.ts` reads `Plan.limits` and `Plan.features`; `src/server/middleware/entitlement.ts` enforces them. Live consumers: the `evidence`, `framework`, `onboarding`, `pentest` and `import` routers, plus the `entitlement` router's read-only dashboard.

## UI

`src/app/dashboard/settings/billing/` with `BillingOverview`, `PlansComparison`, `BillingHistory` (invoices) and `BillingManage` (payment-method update, cancel). `format.ts` renders `Plan.currency` rather than a hardcoded `$` — Razorpay India sells in INR, and a hardcoded symbol would misstate the price to a paying customer.

## Not signed off

Server, workers, schema and UI are complete and unit-tested (`tests/billing.*.test.ts`, five files). **No live provider test-mode cycle has been run end to end** — subscribe → invoice → payment failure → dunning → cancellation, against the real Razorpay or Stripe API. Until that happens this is a code claim, not an operational one. See [[Development_Status]].

Related: [[Database_Design]], [[API_Design]], [[Feature_Backlog]], [[Pricing_Strategy]], [[Security_Architecture]].
