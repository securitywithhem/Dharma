// Phase 3c — Razorpay webhook receiver.
//
// A translator, not a second implementation: it verifies Razorpay's signature,
// unwraps Razorpay's payload shape, and hands off to the shared billing
// lifecycle service that the Stripe receiver also calls. Plan application,
// downgrade, dunning, idempotency and auditing live there, once.
//
// The same three properties the Stripe receiver holds, held here:
//
// 1. AUTHENTICITY — the RAW request body is verified before anything is read
//    from it. Next.js Route Handlers do not body-parse, so `req.text()` gives
//    the exact bytes Razorpay signed. Never switch this to `req.json()`:
//    re-serialising changes the bytes and every signature check fails.
//    Razorpay's scheme is a plain HMAC-SHA256 of the body under the webhook
//    secret, sent in `x-razorpay-signature` — NOT Stripe's timestamped v1
//    scheme. The two are not interchangeable.
// 2. IDEMPOTENCY — Razorpay retries with exponential backoff for 24 hours on
//    any non-2xx or any response slower than 5 seconds, so redelivery is
//    routine rather than exceptional. `x-razorpay-event-id` is the dedupe key.
// 3. CORRECT RETRY SIGNALLING — a non-2xx asks for a retry. Right for
//    transient faults (DB down), wrong for permanently unprocessable events
//    (an org we do not have), which would otherwise retry for a full day.
//    Permanent problems are logged loudly and answered 200.

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { RazorpayProvider, normalizeRazorpaySubscription, type RazorpaySubscriptionEntity } from '@/server/services/payments/razorpayProvider';
import {
  applyPaymentFailed,
  applyPaymentRecovered,
  applySubscriptionCanceled,
  applySubscriptionState,
  resolveOrganizationId,
  type EventRef,
  type LifecycleOutcome,
} from '@/server/services/billing/lifecycle';

const provider = new RazorpayProvider();

/** Razorpay's event envelope, narrowed to what this handler reads. */
interface RazorpayEvent {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity };
    payment?: { entity?: RazorpayPaymentEntity };
    invoice?: { entity?: RazorpayInvoiceEntity };
  };
}

interface RazorpayPaymentEntity {
  id?: string;
  amount?: number;
  invoice_id?: string | null;
  customer_id?: string | null;
  notes?: Record<string, string | number> | null;
}

interface RazorpayInvoiceEntity {
  id?: string;
  amount?: number;
  amount_due?: number;
  customer_id?: string | null;
  subscription_id?: string | null;
  notes?: Record<string, string | number> | null;
}

const IGNORED: LifecycleOutcome = { duplicate: false, applied: false };

/** `notes` values are typed string|number by the API; only strings are IDs. */
function noteString(
  notes: Record<string, string | number> | null | undefined,
  key: string,
): string | undefined {
  const value = notes?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The dedupe key. Razorpay puts no event ID in the body — it sends one in the
 * `x-razorpay-event-id` header. If that header is ever absent, falling back to
 * "no idempotency" would reopen the double-write window on the audit trail, so
 * this synthesises a stable key by hashing the exact signed bytes instead: two
 * deliveries of the same event hash identically, and two genuinely different
 * events cannot collide.
 */
function eventIdFor(headers: Headers, rawBody: string): string {
  const headerId = headers.get('x-razorpay-event-id');
  if (headerId) return headerId;

  const digest = createHash('sha256').update(rawBody).digest('hex');
  logger.warn(
    { digest },
    '[razorpay-webhook] no x-razorpay-event-id header — deduping on a body hash',
  );
  return `body-sha256:${digest}`;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const verification = provider.verifyWebhook(rawBody, req.headers);
  if (!verification.valid) {
    if (verification.reason === 'not-configured') {
      // Our misconfiguration, not Razorpay's fault — 500 so the delivery is
      // retried once the secret is actually set, rather than being lost.
      logger.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set');
      return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }
    // 400 here is correct and final: an unverifiable payload is never retried
    // into validity. Do not echo details — the input is attacker-controlled.
    logger.error(
      { reason: verification.reason },
      '[razorpay-webhook] signature verification failed',
    );
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: RazorpayEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayEvent;
  } catch {
    // Signed but unparseable. Retrying cannot fix malformed JSON.
    logger.error('[razorpay-webhook] signed payload was not valid JSON — dropping');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const eventType = event.event;
  if (!eventType) {
    logger.error('[razorpay-webhook] payload has no event type — dropping');
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const ref: EventRef = {
    provider: 'razorpay',
    eventId: eventIdFor(req.headers, rawBody),
    eventType,
  };

  try {
    const outcome = await handleEvent(ref, event);

    if (outcome.duplicate) {
      logger.info(
        { eventId: ref.eventId, eventType },
        '[razorpay-webhook] duplicate delivery ignored',
      );
    }
    return NextResponse.json({ received: true, duplicate: outcome.duplicate });
  } catch (err) {
    // Transient (DB/Redis) — 500 asks Razorpay to retry, which is what we want.
    logger.error(
      { err, eventId: ref.eventId, eventType },
      '[razorpay-webhook] processing failed; signalling retry',
    );
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

async function handleEvent(ref: EventRef, event: RazorpayEvent): Promise<LifecycleOutcome> {
  switch (ref.eventType) {
    // `activated` is the first event after the customer authorises the mandate;
    // `charged` fires on every successful debit including renewals. Both carry
    // the full subscription entity, so both go through the same authoritative
    // plan sync — which is also what makes the flow self-healing if `activated`
    // is ever missed.
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.updated':
    case 'subscription.resumed':
    case 'subscription.pending':
    case 'subscription.halted':
    case 'subscription.paused':
      return handleSubscriptionState(ref, event);

    case 'subscription.cancelled':
    case 'subscription.completed':
    case 'subscription.expired':
      return handleSubscriptionEnded(ref, event);

    case 'payment.failed':
      return handlePaymentFailed(ref, event);

    default:
      // Razorpay sends many event types; retrying ones we do not care about is
      // pure noise, so this is a 200 by way of the caller.
      logger.debug(
        { eventType: ref.eventType },
        '[razorpay-webhook] unhandled event type',
      );
      return IGNORED;
  }
}

/**
 * Plan sync. `subscription.charged` also clears the dunning clock: a
 * successful debit is Razorpay's payment-recovered signal, and Razorpay has no
 * separate invoice.payment_succeeded event the way Stripe does.
 */
async function handleSubscriptionState(
  ref: EventRef,
  event: RazorpayEvent,
): Promise<LifecycleOutcome> {
  const entity = event.payload?.subscription?.entity;
  if (!entity?.id) {
    logger.error({ eventId: ref.eventId }, '[razorpay-webhook] no subscription entity — dropping');
    return IGNORED;
  }

  const organizationId = await resolveOrganizationId(
    'razorpay',
    noteString(entity.notes, 'organizationId'),
    entity.customer_id ?? null,
    entity.id,
  );

  if (!organizationId) {
    logger.error(
      { eventId: ref.eventId, subscriptionId: entity.id },
      '[razorpay-webhook] subscription for an unknown organization — dropping',
    );
    return IGNORED;
  }

  const subscription = normalizeRazorpaySubscription(entity);

  const plan = subscription.planExternalId
    ? await prisma.plan.findFirst({
        where: provider.planWhereExternalId(subscription.planExternalId),
      })
    : null;

  if (!plan) {
    // A plan sold at Razorpay that we have no Plan row for is a seeding gap,
    // not a transient fault. Retrying cannot fix it; a human must add the row.
    logger.error(
      {
        eventId: ref.eventId,
        razorpayPlanId: subscription.planExternalId,
        organizationId,
      },
      '[razorpay-webhook] no local Plan matches this Razorpay plan — dropping',
    );
    return IGNORED;
  }

  const outcome = await applySubscriptionState({
    ref,
    organizationId,
    planId: plan.id,
    planName: plan.name,
    status: subscription.status,
    rawStatus: subscription.rawStatus,
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    endsAt: subscription.endsAt,
  });

  // A charge that lands while the org is delinquent is the recovery signal.
  // Only after the state write applied, and under its own event key so the
  // dedupe ledger cannot reject it as a duplicate of the state change.
  if (outcome.applied && ref.eventType === 'subscription.charged') {
    await applyPaymentRecovered({
      ref: { ...ref, eventId: `${ref.eventId}:recovered` },
      organizationId,
      invoiceId: event.payload?.payment?.entity?.invoice_id ?? null,
    });
  }

  return outcome;
}

/** Subscription ended — fall back to Free so Free's limits re-apply. */
async function handleSubscriptionEnded(
  ref: EventRef,
  event: RazorpayEvent,
): Promise<LifecycleOutcome> {
  const entity = event.payload?.subscription?.entity;
  if (!entity?.id) {
    logger.error({ eventId: ref.eventId }, '[razorpay-webhook] no subscription entity — dropping');
    return IGNORED;
  }

  const organizationId = await resolveOrganizationId(
    'razorpay',
    noteString(entity.notes, 'organizationId'),
    entity.customer_id ?? null,
    entity.id,
  );

  if (!organizationId) {
    logger.error(
      { eventId: ref.eventId, subscriptionId: entity.id },
      '[razorpay-webhook] cancellation for an unknown organization — dropping',
    );
    return IGNORED;
  }

  return applySubscriptionCanceled({ ref, organizationId });
}

/**
 * Payment failed. Starts the dunning clock; the downgrade decision belongs to
 * the dunning sweep after the grace period, not to this handler.
 */
async function handlePaymentFailed(
  ref: EventRef,
  event: RazorpayEvent,
): Promise<LifecycleOutcome> {
  const payment = event.payload?.payment?.entity;
  const invoice = event.payload?.invoice?.entity;

  // A one-off payment failure unrelated to a subscription is not a billing
  // delinquency and must not start the dunning clock.
  const subscriptionId = invoice?.subscription_id ?? null;
  const customerId = payment?.customer_id ?? invoice?.customer_id ?? null;
  const metadataOrgId =
    noteString(payment?.notes, 'organizationId') ??
    noteString(invoice?.notes, 'organizationId');

  if (!subscriptionId && !metadataOrgId && !customerId) {
    logger.debug(
      { eventId: ref.eventId },
      '[razorpay-webhook] payment failure with no subscription context — ignoring',
    );
    return IGNORED;
  }

  const organizationId = await resolveOrganizationId(
    'razorpay',
    metadataOrgId,
    customerId,
    subscriptionId,
  );

  if (!organizationId) {
    logger.error(
      { eventId: ref.eventId, paymentId: payment?.id },
      '[razorpay-webhook] payment failure for an unknown organization — dropping',
    );
    return IGNORED;
  }

  return applyPaymentFailed({
    ref,
    organizationId,
    invoiceId: invoice?.id ?? payment?.invoice_id ?? null,
    // Razorpay reports amounts in paise, matching Stripe's minor-unit
    // convention, so no conversion is needed here.
    amountDue: invoice?.amount_due ?? payment?.amount ?? null,
  });
}
