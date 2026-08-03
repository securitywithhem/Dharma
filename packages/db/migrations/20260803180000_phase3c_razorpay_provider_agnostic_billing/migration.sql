-- Phase 3c — provider-agnostic billing (Razorpay alongside Stripe).
--
-- Hand-written rather than generated, for the same reason as the Phase 3b
-- migration: `prisma migrate diff` against this schema also emits
-- `DROP INDEX "Control_path_gin_idx"` and a CREATE EXTENSION for vector. That
-- GIN index is created outside Prisma (Prisma cannot express it), so it shows
-- up as drift on every diff and dropping it would silently de-optimise
-- control-tree queries.
--
-- Strictly ADDITIVE with respect to data: no column is dropped or renamed, and
-- the Stripe columns keep every value they hold. The one index that is dropped
-- is replaced in the same transaction by a strictly stronger composite.

-- ── Which provider an organization actually bills through ──────────────────
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'RAZORPAY');

ALTER TABLE "Organization" ADD COLUMN "paymentProvider" "PaymentProvider";
ALTER TABLE "Organization" ADD COLUMN "razorpayCustomerId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "razorpaySubscriptionId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "gstin" TEXT;

-- Razorpay binds the payment mandate to the subscription: changing a card means
-- authorising a NEW subscription and cancelling the old one. The old ID is held
-- here server-side rather than round-tripped through the browser, because a
-- client-supplied cancellation target is an ID an attacker gets to choose.
-- Deliberately NOT unique: it transiently equals razorpaySubscriptionId.
ALTER TABLE "Organization" ADD COLUMN "razorpayPreviousSubscriptionId" TEXT;

CREATE UNIQUE INDEX "Organization_razorpayCustomerId_key"
    ON "Organization"("razorpayCustomerId");
CREATE UNIQUE INDEX "Organization_razorpaySubscriptionId_key"
    ON "Organization"("razorpaySubscriptionId");

-- Backfill: any org that already has Stripe billing identifiers is, by
-- definition, on Stripe. Orgs with neither are left NULL — they have never
-- paid, and stamping a provider on them would make the reconciliation and
-- dunning workers scan them against an API that has never heard of them.
UPDATE "Organization"
   SET "paymentProvider" = 'STRIPE'
 WHERE "stripeCustomerId" IS NOT NULL
    OR "stripeSubscriptionId" IS NOT NULL;

-- ── Plans can be sold through either provider ──────────────────────────────
-- razorpayPlanId is a separate column, not a reuse of stripePriceId: a
-- Razorpay Plan is its own object (plan_…) with its own amount and currency
-- and is in no way interchangeable with a Stripe Price (price_…).
ALTER TABLE "Plan" ADD COLUMN "razorpayPlanId" TEXT;

-- Existing prices were authored in USD; Razorpay India sells in INR. Without
-- this the UI would render "$999" for a rupee-denominated plan.
ALTER TABLE "Plan" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- ── Webhook idempotency ledger becomes provider-namespaced ─────────────────
-- Existing rows are all Stripe deliveries, which is exactly what the column
-- default records. The bare unique on eventId is replaced by the composite so
-- two providers can never collide in the dedupe lock.
ALTER TABLE "ProcessedWebhookEvent"
    ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE';

DROP INDEX "ProcessedWebhookEvent_eventId_key";

CREATE UNIQUE INDEX "ProcessedWebhookEvent_provider_eventId_key"
    ON "ProcessedWebhookEvent"("provider", "eventId");
