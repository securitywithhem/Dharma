// Billing lifecycle.
//
// Every state change a payment webhook can cause lives here, once. The Razorpay
// route handler is a thin translator: it verifies the signature, parses the
// payload shape, and calls these functions. Plan application, downgrade,
// dunning, idempotency and auditing are not duplicated anywhere else — that
// duplication is precisely how a fixed billing bug gets reintroduced.
//
// Three invariants:
//
// 1. IDEMPOTENCY. The dedupe claim is taken INSIDE the same transaction as the
//    state change, so a mid-handler failure rolls the claim back and the
//    provider's retry gets a genuine second attempt. Claiming outside would
//    mark an event processed that never applied — a silently dropped
//    subscription.
// 2. THE ORG IS NEVER TRUSTED FROM METADATA. A provider `notes`/`metadata`
//    field is arbitrary attacker-or-operator-editable string data. It is
//    existence-checked and falls back to a customer-ID lookup. Handing an
//    unknown ID to organization.update throws, which the route reads as a
//    transient fault and answers 500 — putting the provider into a retry loop
//    that can never succeed. This exact bug was found once already.
// 3. EVERY APPLIED CHANGE IS AUDITED, with the provider recorded, because a
//    plan changing underneath a customer is the kind of event this product
//    exists to make explainable.

import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { emitAuditEvent } from '@/server/services/audit/writer';
import { enqueueDunningNotification } from '@/server/queue/dunningQueue';
import { logger } from '@/lib/logger';
import type { DharmaSubscriptionStatus } from '@/server/services/payments/types';

/** The Organization columns holding Razorpay's identifiers. */
const columns = {
  customerId: 'razorpayCustomerId',
  subscriptionId: 'razorpaySubscriptionId',
} as const;

export interface EventRef {
  /** Razorpay's own event identifier — the dedupe key. */
  eventId: string;
  eventType: string;
}

export type LifecycleOutcome = { duplicate: boolean; applied: boolean };

const IGNORED: LifecycleOutcome = { duplicate: false, applied: false };
const APPLIED: LifecycleOutcome = { duplicate: false, applied: true };
const DUPLICATE: LifecycleOutcome = { duplicate: true, applied: false };

/**
 * Claim this event, or report that another delivery already has it.
 * Runs inside the caller's transaction — see invariant 1 above.
 */
async function recordEventOnce(
  tx: Prisma.TransactionClient,
  ref: EventRef,
): Promise<boolean> {
  try {
    await tx.processedWebhookEvent.create({
      data: {
        eventId: ref.eventId,
        eventType: ref.eventType,
      },
    });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return false; // already processed by a prior delivery
    }
    throw err;
  }
}

/**
 * Resolve the Dharma org for a Razorpay object.
 *
 * Prefers the ID stamped in Razorpay `notes` but EXISTENCE-CHECKS it, then
 * falls back to the Razorpay customer ID, then to a known subscription ID. The
 * fallback is not defensive padding: subscription changes made from the
 * Razorpay dashboard carry no Dharma metadata at all, and dropping those would
 * leave the local plan stale. Never write an unverified ID straight through.
 */
export async function resolveOrganizationId(
  metadataOrgId: string | undefined | null,
  providerCustomerId: string | null,
  providerSubscriptionId?: string | null,
): Promise<string | null> {
  if (metadataOrgId) {
    const byMetadata = await prisma.organization.findUnique({
      where: { id: metadataOrgId },
      select: { id: true },
    });
    if (byMetadata) return byMetadata.id;

    logger.warn(
      { metadataOrgId },
      '[billing] metadata organizationId does not exist — falling back to customer lookup',
    );
  }

  if (providerCustomerId) {
    const byCustomer = await prisma.organization.findFirst({
      where: { [columns.customerId]: providerCustomerId },
      select: { id: true },
    });
    if (byCustomer) return byCustomer.id;
  }

  // Last resort: the subscription itself. Razorpay's first webhook for a new
  // subscription can arrive before a customer ID has been attached locally,
  // and the subscription ID is recorded at checkout, so this closes a real gap
  // rather than being belt-and-braces.
  if (providerSubscriptionId) {
    const bySubscription = await prisma.organization.findFirst({
      where: { [columns.subscriptionId]: providerSubscriptionId },
      select: { id: true },
    });
    if (bySubscription) return bySubscription.id;
  }

  return null;
}

/**
 * Purchase confirmed. Attaches the Razorpay customer and subscription to the
 * org; the plan itself is applied by applySubscriptionState, which reads the
 * authoritative current plan from the subscription object.
 */
export async function applyCheckoutCompleted(args: {
  ref: EventRef;
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
}): Promise<LifecycleOutcome> {
  const { ref, organizationId } = args;

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await recordEventOnce(tx, ref))) return false;

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        ...(args.customerId ? { [columns.customerId]: args.customerId } : {}),
        ...(args.subscriptionId ? { [columns.subscriptionId]: args.subscriptionId } : {}),
      },
    });
    return true;
  });

  if (!applied) return DUPLICATE;

  await emitAuditEvent(prisma, {
    organizationId,
    userId: null, // Provider-initiated: no authenticated actor in this request.
    action: 'BILLING_CHECKOUT_COMPLETED',
    entity: 'Organization',
    entityId: organizationId,
    changes: {
      subscriptionId: args.subscriptionId,
      eventId: ref.eventId,
    },
  });

  return APPLIED;
}

/**
 * Authoritative plan sync: create, upgrade, downgrade and mid-cycle change.
 *
 * `planId` is resolved by the caller from the provider's own plan/price
 * identifier. A null plan means we sold something we have no local Plan row
 * for — a seeding gap a human must fix, which retrying cannot; the caller
 * drops the event rather than looping.
 */
export async function applySubscriptionState(args: {
  ref: EventRef;
  organizationId: string;
  planId: string;
  planName: string;
  status: DharmaSubscriptionStatus;
  rawStatus: string;
  customerId: string | null;
  subscriptionId: string;
  endsAt: Date | null;
}): Promise<LifecycleOutcome> {
  const { ref, organizationId } = args;

  const before = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { planId: true, subscriptionStatus: true },
  });

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await recordEventOnce(tx, ref))) return false;

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        ...(args.customerId ? { [columns.customerId]: args.customerId } : {}),
        [columns.subscriptionId]: args.subscriptionId,
        planId: args.planId,
        subscriptionStatus: args.status,
        subscriptionEndsAt: args.endsAt,
      },
    });
    return true;
  });

  if (!applied) return DUPLICATE;

  await emitAuditEvent(prisma, {
    organizationId,
    userId: null,
    action: 'BILLING_PLAN_UPDATED',
    entity: 'Organization',
    entityId: organizationId,
    changes: {
      from: { planId: before?.planId ?? null },
      to: { planId: args.planId, planName: args.planName },
      providerStatus: args.rawStatus,
      eventId: ref.eventId,
    },
  });

  return APPLIED;
}

/**
 * Subscription ended — fall back to Free so Free's limits re-apply.
 *
 * Throws when no Free plan exists. Unlike the unknown-plan case this is unsafe
 * to swallow: the org would keep paid entitlements it is no longer paying for,
 * so the provider should retry while an operator fixes the seed.
 */
export async function applySubscriptionCanceled(args: {
  ref: EventRef;
  organizationId: string;
}): Promise<LifecycleOutcome> {
  const { ref, organizationId } = args;

  const freePlan = await prisma.plan.findFirst({ where: { name: 'free' } });
  if (!freePlan) {
    throw new Error('No "free" Plan row exists to downgrade a canceled org into');
  }

  const before = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { planId: true },
  });

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await recordEventOnce(tx, ref))) return false;

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        [columns.subscriptionId]: null,
        planId: freePlan.id,
        subscriptionStatus: 'CANCELED',
        dunningStartedAt: null, // no longer delinquent; there is nothing to pay
      },
    });
    return true;
  });

  if (!applied) return DUPLICATE;

  await emitAuditEvent(prisma, {
    organizationId,
    userId: null,
    action: 'BILLING_SUBSCRIPTION_CANCELED',
    entity: 'Organization',
    entityId: organizationId,
    changes: {
      from: { planId: before?.planId ?? null },
      to: { planId: freePlan.id, planName: 'free' },
      eventId: ref.eventId,
    },
  });

  return APPLIED;
}

/**
 * Payment failed. Deliberately does NOT downgrade: both providers retry a
 * failed charge over roughly two weeks, and cutting access on the first
 * failure would punish customers for an expired card. Start the dunning clock
 * — only on the FIRST failure, or the grace period becomes unbounded — and let
 * the dunning worker decide after it elapses.
 */
export async function applyPaymentFailed(args: {
  ref: EventRef;
  organizationId: string;
  invoiceId: string | null;
  amountDue: number | null;
}): Promise<LifecycleOutcome> {
  const { ref, organizationId } = args;

  const before = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { dunningStartedAt: true },
  });
  const dunningStartedAt = before?.dunningStartedAt ?? new Date();

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await recordEventOnce(tx, ref))) return false;

    await tx.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus: 'PAST_DUE', dunningStartedAt },
    });
    return true;
  });

  if (!applied) return DUPLICATE;

  await emitAuditEvent(prisma, {
    organizationId,
    userId: null,
    action: 'BILLING_PAYMENT_FAILED',
    entity: 'Organization',
    entityId: organizationId,
    changes: {
      invoiceId: args.invoiceId,
      amountDue: args.amountDue,
      dunningStartedAt: dunningStartedAt.toISOString(),
      eventId: ref.eventId,
    },
  });

  await enqueueDunningNotification({ organizationId, invoiceId: args.invoiceId });

  return APPLIED;
}

/** Payment recovered — stop the dunning clock. */
export async function applyPaymentRecovered(args: {
  ref: EventRef;
  organizationId: string;
  invoiceId: string | null;
}): Promise<LifecycleOutcome> {
  const { ref, organizationId } = args;

  const before = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { dunningStartedAt: true },
  });

  const applied = await prisma.$transaction(async (tx) => {
    if (!(await recordEventOnce(tx, ref))) return false;

    await tx.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus: 'ACTIVE', dunningStartedAt: null },
    });
    return true;
  });

  if (!applied) return DUPLICATE;

  // Only audit a genuine recovery, not every routine renewal payment.
  if (before?.dunningStartedAt) {
    await emitAuditEvent(prisma, {
      organizationId,
      userId: null,
      action: 'BILLING_PAYMENT_RECOVERED',
      entity: 'Organization',
      entityId: organizationId,
      changes: {
        invoiceId: args.invoiceId,
        eventId: ref.eventId,
      },
    });
  }

  return APPLIED;
}

export { IGNORED as LIFECYCLE_IGNORED };
