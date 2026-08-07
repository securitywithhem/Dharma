// Phase 3c — Razorpay webhook receiver.
//
// A translator, not a second implementation: it verifies Razorpay's signature,
// unwraps Razorpay's payload shape, and hands off to the shared billing
// lifecycle service. Plan application,
// downgrade, dunning, idempotency and auditing live there, once.
//
// Three properties this receiver holds:
//
// 1. AUTHENTICITY — the RAW request body is verified before anything is read
//    from it. Next.js Route Handlers do not body-parse, so `req.text()` gives
//    the exact bytes Razorpay signed. Never switch this to `req.json()`:
//    re-serialising changes the bytes and every signature check fails.
//    Razorpay's scheme is a plain HMAC-SHA256 of the body under the webhook
//    secret, sent in `x-razorpay-signature` — NOT a timestamped v1
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
import {
  RazorpayProvider,
  normalizeRazorpaySubscription,
  RAZORPAY_SIGNATURE_HEADER,
  type RazorpaySubscriptionEntity,
} from '@/server/services/payments/razorpayProvider';
import { opsAlert } from '@/server/lib/ops/alert';
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

/**
 * Condense an error into something an alert can actually carry.
 *
 * Prisma embeds the failing call site — in a production build, a slab of
 * minified bundle source — directly into `err.message`. Passing that through
 * verbatim produces a ~2KB pager message that is unreadable, and pushes bundle
 * internals into a third-party alert channel, which the opsAlert contract
 * explicitly rules out. The first line carries the actual cause
 * ("Server has closed the connection.", a constraint name, a timeout); the
 * rest is context better read from the full `logger.error` beside it, which
 * stays on stdout where it belongs.
 */
function alertSafeReason(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown';

  const lines = err.message.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return err.name;

  // Prisma's shape is: "Invalid `x.create()` invocation in" / <code> / <cause>.
  // The FIRST line names the operation and the LAST line is the actual cause
  // ("Server has closed the connection.", a constraint name, a timeout) — the
  // one an operator needs. Keeping both, and nothing in between, is what makes
  // this readable as a page. For a single-line error the two coincide.
  const head = lines[0];
  const tail = lines[lines.length - 1];
  const reason = head === tail ? head : `${head} … ${tail}`;

  return reason.length > 300 ? `${reason.slice(0, 300)}…` : reason;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const verification = provider.verifyWebhook(rawBody, req.headers);
  if (!verification.valid) {
    // Highest-severity alert in the system. While this is failing, EVERY event
    // Razorpay sends is rejected — a customer can complete a payment and never
    // be upgraded. A rotated or mismatched RAZORPAY_WEBHOOK_SECRET is otherwise
    // completely silent from our side: Razorpay sees 4xx/5xx and retries for
    // 24h, we see nothing, and the customer sees the Free plan they just paid
    // to leave. One alert covers all verification failures, with the reason in
    // context, because the operator response is the same: check the secret.
    await opsAlert({
      event: 'billing.webhook.signature_invalid',
      severity: 'CRITICAL',
      message:
        'Razorpay webhook signature verification FAILED — subscription events are being rejected. ' +
        'Check RAZORPAY_WEBHOOK_SECRET matches the secret set on the webhook in the Razorpay dashboard.',
      context: {
        reason: verification.reason,
        hasSignatureHeader: Boolean(req.headers.get(RAZORPAY_SIGNATURE_HEADER)),
        secretConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      },
    });

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
    // The signature was valid, so this is a genuine Razorpay event we failed to
    // apply — a DB outage mid-upgrade, a constraint violation, a Redis fault.
    // Razorpay will retry a 500, but only within its 24h window, so a fault
    // that outlasts the window silently strands a paying customer.
    await opsAlert({
      event: 'billing.webhook.processing_error',
      severity: 'CRITICAL',
      message:
        `Failed to process Razorpay event ${eventType} (${ref.eventId}): ` +
        alertSafeReason(err),
      context: { eventId: ref.eventId, eventType },
    });
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
 * separate invoice.payment_succeeded event.
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
    noteString(entity.notes, 'organizationId'),
    entity.customer_id ?? null,
    entity.id,
  );

  if (!organizationId) {
    // Money moved and the entitlement did not. This event is dropped (200, so
    // Razorpay stops retrying something retrying cannot fix), which means the
    // paying customer stays on their old plan indefinitely unless a human is
    // told. resolveOrganizationId already tried notes → customer → subscription.
    await opsAlert({
      event: 'billing.webhook.missing_organization_id',
      severity: 'CRITICAL',
      message:
        `Subscription ${entity.id} could not be resolved to any organization — ` +
        'the paying customer will NOT be upgraded.',
      context: {
        eventId: ref.eventId,
        eventType: ref.eventType,
        subscriptionId: entity.id,
        customerId: entity.customer_id ?? null,
        notesOrgId: noteString(entity.notes, 'organizationId') ?? null,
      },
    });
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
    await opsAlert({
      event: 'billing.webhook.unknown_plan_id',
      severity: 'CRITICAL',
      message:
        `No Plan row matches Razorpay plan ${subscription.planExternalId ?? '(none on subscription)'} — ` +
        `org ${organizationId} paid but cannot be mapped to a plan. Seed/repair the Plan table.`,
      context: {
        eventId: ref.eventId,
        razorpayPlanId: subscription.planExternalId,
        organizationId,
        subscriptionId: subscription.id,
      },
    });
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
    noteString(entity.notes, 'organizationId'),
    entity.customer_id ?? null,
    entity.id,
  );

  if (!organizationId) {
    // Inverse of the upgrade case and just as bad: a cancellation we cannot
    // attribute leaves an org on a paid plan it is no longer paying for.
    await opsAlert({
      event: 'billing.webhook.missing_organization_id',
      severity: 'CRITICAL',
      message:
        `Cancellation of subscription ${entity.id} could not be resolved to any ` +
        'organization — the org will NOT be downgraded.',
      context: {
        eventId: ref.eventId,
        eventType: ref.eventType,
        subscriptionId: entity.id,
        customerId: entity.customer_id ?? null,
        notesOrgId: noteString(entity.notes, 'organizationId') ?? null,
      },
    });
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
    metadataOrgId,
    customerId,
    subscriptionId,
  );

  if (!organizationId) {
    // A failed charge we cannot attribute means the dunning clock never starts,
    // so the org keeps paid access indefinitely without paying for it.
    await opsAlert({
      event: 'billing.webhook.missing_organization_id',
      severity: 'CRITICAL',
      message:
        `Payment failure ${payment?.id ?? '(unknown payment)'} could not be resolved to ` +
        'any organization — the dunning clock will NOT start.',
      context: {
        eventId: ref.eventId,
        eventType: ref.eventType,
        paymentId: payment?.id ?? null,
        subscriptionId,
        customerId,
        notesOrgId: metadataOrgId ?? null,
      },
    });
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
    // Razorpay reports amounts in paise — a minor-unit
    // convention, so no conversion is needed here.
    amountDue: invoice?.amount_due ?? payment?.amount ?? null,
  });
}
