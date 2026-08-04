-- Phase 3b — Billing & Subscription lifecycle.
--
-- Hand-written rather than generated: `prisma migrate diff` against this
-- schema also emits `DROP INDEX "Control_path_gin_idx"` and a CREATE EXTENSION
-- for vector. That index is created outside Prisma (it is a GIN index Prisma
-- cannot express), so it shows up as drift on every diff. Including the drop
-- here would silently de-optimise control-tree queries, so only the two
-- intended changes are applied.

-- Dunning clock: set on the first invoice.payment_failed, cleared on payment.
ALTER TABLE "Organization" ADD COLUMN "dunningStartedAt" TIMESTAMP(3);

-- Stripe webhook idempotency ledger. The unique constraint on eventId is the
-- dedupe lock — a redelivered event loses the insert race and is skipped.
CREATE TABLE "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessedWebhookEvent_eventId_key" ON "ProcessedWebhookEvent"("eventId");

CREATE INDEX "ProcessedWebhookEvent_processedAt_idx" ON "ProcessedWebhookEvent"("processedAt");
