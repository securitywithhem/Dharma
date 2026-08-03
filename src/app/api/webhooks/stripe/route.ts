// Phase 3b/3c — Stripe webhook receiver.
//
// Phase 3c reduced this file to a translator: it verifies Stripe's signature,
// unwraps Stripe's payload shapes, and hands off to the shared billing
// lifecycle service that the Razorpay receiver also calls. The state changes,
// idempotency claim, dunning trigger and audit writes all moved verbatim to
// src/server/services/billing/lifecycle.ts — behaviour is unchanged, but there
// is now exactly one copy of that logic, so a fix or a bug can no longer apply
// to one provider and not the other.
//
// Stripe is DORMANT for this deployment (PAYMENT_PROVIDER=razorpay) but this
// route stays live: an org that subscribed through Stripe is still billed,
// reconciled and dunned through Stripe.
//
// Three properties this handler must hold, in order of importance:
//
// 1. AUTHENTICITY — the raw request body is verified against the signing
//    secret before anything is read from it. Next.js Route Handlers do not
//    body-parse, so `req.text()` gives the exact bytes Stripe signed. Never
//    switch this to `req.json()`: re-serialising changes the bytes and every
//    signature check fails.
// 2. IDEMPOTENCY — Stripe delivers at least once and redelivers on timeout or
//    manual resend. State changes and their AuditEvents must happen exactly
//    once. See recordEventOnce() in the lifecycle service for how the race is
//    closed.
// 3. CORRECT RETRY SIGNALLING — a non-2xx tells Stripe to retry. That is right
//    for transient faults (DB down) and wrong for permanently unprocessable
//    events (an org we do not have), which would otherwise retry for days.
//    Permanent problems are logged loudly and answered 200.
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/server/db';
import stripe from '@/lib/stripe';
import { StripeProvider, normalizeStripeSubscription } from '@/server/services/payments/stripeProvider';
import {
  applyCheckoutCompleted,
  applyPaymentFailed,
  applyPaymentRecovered,
  applySubscriptionCanceled,
  applySubscriptionState,
  resolveOrganizationId,
  type EventRef,
  type LifecycleOutcome,
} from '@/server/services/billing/lifecycle';
import { logger } from '@/lib/logger';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
const provider = new StripeProvider();

const IGNORED: LifecycleOutcome = { duplicate: false, applied: false };

/** Stripe moves `customer` between a bare ID and an expanded object. */
function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
) {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function refFor(event: Stripe.Event): EventRef {
  return { provider: 'stripe', eventId: event.id, eventType: event.type };
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    // 400 here is correct and final: an unverifiable payload is never retried
    // into validity. Do not echo the error text — it is attacker-controlled.
    logger.error({ err }, '[stripe-webhook] signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await handleEvent(event);

    if (outcome.duplicate) {
      logger.info(
        { eventId: event.id, eventType: event.type },
        '[stripe-webhook] duplicate delivery ignored',
      );
    }
    return NextResponse.json({ received: true, duplicate: outcome.duplicate });
  } catch (err) {
    // Transient (DB/Redis) — 500 asks Stripe to retry, which is what we want.
    logger.error(
      { err, eventId: event.id, eventType: event.type },
      '[stripe-webhook] processing failed; signalling retry',
    );
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<LifecycleOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event);

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return handleSubscriptionUpsert(event);

    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event);

    case 'invoice.payment_failed':
      return handlePaymentFailed(event);

    case 'invoice.payment_succeeded':
      return handlePaymentSucceeded(event);

    default:
      // Unhandled types are still 200 — Stripe sends many event types and
      // retrying ones we do not care about is pure noise.
      logger.debug({ eventType: event.type }, '[stripe-webhook] unhandled event type');
      return IGNORED;
  }
}

/**
 * First signal that a purchase succeeded. Attaches the Stripe customer and
 * subscription to the org; the plan itself is applied by the
 * customer.subscription.* event, which is the authoritative source of the
 * current price.
 */
async function handleCheckoutCompleted(event: Stripe.Event): Promise<LifecycleOutcome> {
  const session = event.data.object as Stripe.Checkout.Session;
  const customerId = customerIdOf(session.customer);
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id ?? null;

  const organizationId = await resolveOrganizationId(
    'stripe',
    session.metadata?.organizationId,
    customerId,
    subscriptionId,
  );

  if (!organizationId) {
    logger.error(
      { eventId: event.id, sessionId: session.id },
      '[stripe-webhook] checkout completed for an unknown organization — dropping',
    );
    return IGNORED;
  }

  return applyCheckoutCompleted({
    ref: refFor(event),
    organizationId,
    customerId,
    subscriptionId,
  });
}

/** Authoritative plan sync: create, upgrade, downgrade, and mid-cycle change. */
async function handleSubscriptionUpsert(event: Stripe.Event): Promise<LifecycleOutcome> {
  const raw = event.data.object as Stripe.Subscription;
  const subscription = normalizeStripeSubscription(raw);

  const organizationId = await resolveOrganizationId(
    'stripe',
    raw.metadata?.organizationId,
    subscription.customerId,
    subscription.id,
  );

  if (!organizationId) {
    logger.error(
      { eventId: event.id, subscriptionId: subscription.id },
      '[stripe-webhook] subscription for an unknown organization — dropping',
    );
    return IGNORED;
  }

  const plan = subscription.planExternalId
    ? await prisma.plan.findFirst({
        where: provider.planWhereExternalId(subscription.planExternalId),
      })
    : null;

  if (!plan) {
    // A price sold in Stripe that we have no Plan row for is a seeding gap, not
    // a transient fault. Retrying cannot fix it; a human must add the Plan.
    logger.error(
      { eventId: event.id, priceId: subscription.planExternalId, organizationId },
      '[stripe-webhook] no local Plan matches this Stripe price — dropping',
    );
    return IGNORED;
  }

  return applySubscriptionState({
    ref: refFor(event),
    organizationId,
    planId: plan.id,
    planName: plan.name,
    status: subscription.status,
    rawStatus: subscription.rawStatus,
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    endsAt: subscription.endsAt,
  });
}

/** Subscription ended — fall back to Free and re-apply Free's limits. */
async function handleSubscriptionDeleted(event: Stripe.Event): Promise<LifecycleOutcome> {
  const subscription = event.data.object as Stripe.Subscription;

  const organizationId = await resolveOrganizationId(
    'stripe',
    subscription.metadata?.organizationId,
    customerIdOf(subscription.customer),
    subscription.id,
  );

  if (!organizationId) {
    logger.error(
      { eventId: event.id, subscriptionId: subscription.id },
      '[stripe-webhook] cancellation for an unknown organization — dropping',
    );
    return IGNORED;
  }

  return applySubscriptionCanceled({ ref: refFor(event), organizationId });
}

/**
 * Payment failed. Deliberately does NOT downgrade: Stripe retries a failed
 * invoice over roughly two weeks, and cutting access on the first failure
 * would punish customers for an expired card. Start the dunning clock (only
 * on the first failure) and let the dunning worker decide after the grace
 * period. See src/server/queue/workers/dunningWorker.ts.
 */
async function handlePaymentFailed(event: Stripe.Event): Promise<LifecycleOutcome> {
  const invoice = event.data.object as Stripe.Invoice;

  const organizationId = await resolveOrganizationId(
    'stripe',
    invoice.metadata?.organizationId ?? undefined,
    customerIdOf(invoice.customer),
  );

  if (!organizationId) {
    logger.error(
      { eventId: event.id, invoiceId: invoice.id },
      '[stripe-webhook] payment failure for an unknown organization — dropping',
    );
    return IGNORED;
  }

  return applyPaymentFailed({
    ref: refFor(event),
    organizationId,
    invoiceId: invoice.id ?? null,
    amountDue: invoice.amount_due,
  });
}

/** Payment recovered — stop the dunning clock. */
async function handlePaymentSucceeded(event: Stripe.Event): Promise<LifecycleOutcome> {
  const invoice = event.data.object as Stripe.Invoice;

  const organizationId = await resolveOrganizationId(
    'stripe',
    invoice.metadata?.organizationId ?? undefined,
    customerIdOf(invoice.customer),
  );
  if (!organizationId) return IGNORED;

  return applyPaymentRecovered({
    ref: refFor(event),
    organizationId,
    invoiceId: invoice.id ?? null,
  });
}
