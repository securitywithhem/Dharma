-- Remove Stripe. Razorpay becomes the sole payment provider.
--
-- Stripe is invite-only for India-based accounts and cannot be activated for
-- real sales, so it was removed outright rather than left dormant behind an
-- adapter interface. See claude/fixes-2026-08-05-stripe-removal.md.
--
-- DATA SAFETY: verified before writing this migration that no Organization row
-- has a non-null stripeCustomerId or stripeSubscriptionId (0 of 39 orgs), and
-- that Plan.stripePriceId held only placeholder seed values
-- ('prod_test_pro', 'prod_test_enterprise') which are not even well-formed
-- Stripe price IDs. Nothing billable is dropped here. The guard below turns
-- that verification into an enforced precondition rather than a claim in a
-- comment, so this migration REFUSES to run against any database where real
-- Stripe linkage exists.
DO $$
DECLARE
  linked_orgs bigint;
BEGIN
  SELECT count(*) INTO linked_orgs
  FROM "Organization"
  WHERE "stripeCustomerId" IS NOT NULL
     OR "stripeSubscriptionId" IS NOT NULL;

  IF linked_orgs > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop Stripe columns: % organization(s) still carry Stripe identifiers. Migrate or archive them first.',
      linked_orgs;
  END IF;
END $$;

-- ProcessedWebhookEvent: the (provider, eventId) composite existed only to stop
-- one provider's event ID suppressing another's. With one provider there is no
-- second namespace, so the unique collapses back onto eventId alone.
--
-- Ordering matters: drop the composite index BEFORE deleting rows, and delete
-- any legacy STRIPE-issued rows BEFORE adding the bare unique — two providers
-- could in principle have issued the same eventId string, and that would make
-- the new constraint fail to build.
DROP INDEX IF EXISTS "ProcessedWebhookEvent_provider_eventId_key";

DELETE FROM "ProcessedWebhookEvent" WHERE "provider" = 'STRIPE';

-- Defensive: if any duplicate eventId survives (it should not), keep the
-- earliest row. Deleting the ledger wholesale would reopen the idempotency
-- window for any Razorpay event still inside its 24h retry horizon.
DELETE FROM "ProcessedWebhookEvent" a
USING "ProcessedWebhookEvent" b
WHERE a."eventId" = b."eventId"
  AND a."processedAt" > b."processedAt";

ALTER TABLE "ProcessedWebhookEvent" DROP COLUMN "provider";

CREATE UNIQUE INDEX "ProcessedWebhookEvent_eventId_key"
  ON "ProcessedWebhookEvent"("eventId");

-- Organization: drop Stripe identifiers and the now-meaningless discriminator.
ALTER TABLE "Organization"
  DROP COLUMN "stripeCustomerId",
  DROP COLUMN "stripeSubscriptionId",
  DROP COLUMN "paymentProvider";

-- Plan: drop the Stripe price identifier.
ALTER TABLE "Plan" DROP COLUMN "stripePriceId";

-- Razorpay India sells in INR, so new Plan rows default to INR.
--
-- EXISTING ROWS ARE DELIBERATELY NOT TOUCHED. Their `price` values (99, 999)
-- were authored as USD amounts; flipping `currency` to INR without converting
-- the amount would render "₹99" for a plan priced at $99 — misstating a price
-- to a paying customer, which is the exact bug `currency` was added to prevent.
-- Re-seed with real INR amounts instead:
--   BILLING_CURRENCY=INR BILLING_PRICE_PRO=... BILLING_PRICE_ENTERPRISE=... \
--     npm run seed:plans
ALTER TABLE "Plan" ALTER COLUMN "currency" SET DEFAULT 'INR';

DROP TYPE IF EXISTS "PaymentProvider";
