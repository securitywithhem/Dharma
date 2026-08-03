// Phase 3c — Stripe behind the PaymentProvider interface.
//
// This adapter is a wrapper, not a rewrite. Every Stripe call still goes
// through src/lib/stripe.ts exactly as it did before the Razorpay migration,
// including the subscription_data.metadata fix that made checkout metadata
// reach the Subscription object (see the comment in that file — losing it
// means paying customers are never upgraded). The only new work here is
// normalising Stripe's shapes into the interface's vocabulary.
//
// Stripe is DORMANT for this deployment (PAYMENT_PROVIDER=razorpay) but must
// stay functionally intact: an org still carrying stripeSubscriptionId is
// reconciled and dunned through this adapter.

import Stripe from 'stripe';
import type { PaymentProvider as PaymentProviderEnum, Plan } from '@prisma/client';
import stripe, {
  createCheckoutSession,
  createBillingPortalSession,
  listInvoices as listStripeInvoices,
  updateSubscription as updateStripeSubscription,
  cancelSubscription as cancelStripeSubscription,
  mapStripeStatus,
} from '@/lib/stripe';
import {
  ProviderUnreachableError,
  type CheckoutHandoff,
  type CreateCheckoutArgs,
  type ListInvoicesArgs,
  type NormalizedInvoice,
  type NormalizedSubscription,
  type PaymentProviderAdapter,
  type WebhookVerification,
} from './provider';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/** Stripe statuses a customer can no longer recover from on their own. */
const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

export function normalizeStripeSubscription(
  subscription: Stripe.Subscription,
): NormalizedSubscription {
  // Stripe has moved current_period_end between the subscription and its items
  // across API versions; the existing router already read it via `any` for that
  // reason and this preserves that behaviour rather than changing it here.
  const raw = subscription as unknown as Record<string, number | null | undefined>;

  return {
    id: subscription.id,
    status: mapStripeStatus(subscription.status),
    rawStatus: subscription.status,
    isTerminal: TERMINAL_STATUSES.has(subscription.status),
    currentPeriodEnd: toDate(raw.current_period_end),
    endsAt: toDate(subscription.cancel_at),
    canceledAt: toDate(raw.canceled_at),
    planExternalId: subscription.items.data[0]?.price.id ?? null,
    customerId: customerIdOf(subscription.customer),
  };
}

/** Stripe signals "this object is gone" with a specific error code. */
function isResourceMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === 'resource_missing';
}

export class StripeProvider implements PaymentProviderAdapter {
  readonly name = 'stripe' as const;
  readonly enumValue: PaymentProviderEnum = 'STRIPE';

  isConfigured(): boolean {
    const key = process.env.STRIPE_SECRET_KEY;
    return Boolean(key && !key.includes('placeholder') && !key.includes('YOUR'));
  }

  planExternalId(plan: Plan): string | null {
    return plan.stripePriceId;
  }

  planWhereExternalId(externalId: string) {
    return { stripePriceId: externalId };
  }

  async createCheckout(args: CreateCheckoutArgs): Promise<CheckoutHandoff> {
    const priceId = this.planExternalId(args.plan);
    if (!priceId) {
      throw new Error(`Plan "${args.plan.name}" has no Stripe price configured`);
    }

    const session = await createCheckoutSession(
      args.organizationId,
      priceId,
      args.successUrl,
      args.cancelUrl,
      args.customerEmail,
    );

    return {
      kind: 'redirect',
      provider: 'stripe',
      reference: session.id,
      url: session.url,
    };
  }

  async getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null> {
    try {
      return normalizeStripeSubscription(
        await stripe.subscriptions.retrieve(subscriptionId),
      );
    } catch (err) {
      // Gone (null) and unreachable (throw) must stay distinguishable — the
      // dunning sweep downgrades on the first and skips on the second.
      if (isResourceMissing(err)) return null;
      throw new ProviderUnreachableError('stripe', err);
    }
  }

  async updateSubscription(
    subscriptionId: string,
    planExternalId: string,
  ): Promise<NormalizedSubscription> {
    return normalizeStripeSubscription(
      await updateStripeSubscription(subscriptionId, planExternalId),
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<NormalizedSubscription> {
    return normalizeStripeSubscription(await cancelStripeSubscription(subscriptionId));
  }

  async listInvoices(args: ListInvoicesArgs): Promise<NormalizedInvoice[]> {
    if (!args.customerId) return [];
    const invoices = await listStripeInvoices(args.customerId, args.limit ?? 24);

    return invoices.map((invoice) => ({
      id: invoice.id ?? '',
      number: invoice.number ?? null,
      status: invoice.status ?? null,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      createdAt: new Date(invoice.created * 1000),
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
    }));
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const session = await createBillingPortalSession(customerId, returnUrl);
    return { url: session.url };
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
    const signature = headers.get('stripe-signature');
    if (!signature) return { valid: false, reason: 'missing-signature' };
    if (!webhookSecret) return { valid: false, reason: 'not-configured' };

    try {
      stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return { valid: true };
    } catch {
      return { valid: false, reason: 'invalid-signature' };
    }
  }
}
