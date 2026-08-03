// Phase 3c — Razorpay behind the PaymentProvider interface.
//
// This is the LIVE provider for this deployment. Three things differ materially
// from the Stripe adapter and are handled explicitly rather than by analogy:
//
// 1. CHECKOUT SHAPE. Stripe Checkout is a server-side redirect to a hosted
//    page. Razorpay's subscription flow creates the Subscription server-side
//    and then opens Checkout.js as an in-page modal against that subscription
//    ID. There is no URL to redirect to, so this adapter returns a `modal`
//    handoff (see CheckoutHandoff) and the browser does the rest.
//
// 2. METADATA PLACEMENT. The single worst bug in the Stripe implementation was
//    metadata set on the Checkout Session, which Stripe does not propagate to
//    the Subscription — so every subscription webhook arrived with no org and
//    paying customers were never upgraded. The equivalent trap does not exist
//    here for a structural reason worth stating: this adapter creates the
//    Subscription itself, so `notes` are set directly on the object the webhook
//    later delivers (payload.subscription.entity.notes). It is verified by test
//    rather than assumed, and the webhook still existence-checks the org and
//    falls back to razorpayCustomerId, so a missing note degrades gracefully.
//
// 3. NO HOSTED PORTAL. Razorpay has no Billing Portal equivalent, so
//    createPortalSession returns null and Dharma ships its own self-serve
//    management screen instead of a dead "Manage billing" button.

import type { PaymentProvider as PaymentProviderEnum, Plan } from '@prisma/client';
import razorpay, {
  mapRazorpayStatus,
  RAZORPAY_TERMINAL_STATUSES,
} from '@/lib/razorpay';
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

/**
 * Razorpay requires `total_count` — it has no "until cancelled" subscription.
 * 120 monthly cycles (10 years) is the practical stand-in: long enough that no
 * real customer reaches it, short enough to be a finite, auditable commitment
 * rather than a number that looks like a bug. A subscription that did complete
 * would arrive as `subscription.completed` → CANCELED, which is the same
 * downgrade path as any other ending, so the tail case is handled, not ignored.
 */
export const RAZORPAY_TOTAL_BILLING_CYCLES = 120;

/** The header Razorpay signs every webhook delivery with. */
export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/** Razorpay's raw subscription entity, narrowed to the fields used here. */
export interface RazorpaySubscriptionEntity {
  id: string;
  status: string;
  plan_id?: string;
  customer_id?: string | null;
  current_end?: number | null;
  ended_at?: number | null;
  charge_at?: number | null;
  notes?: Record<string, string | number> | null;
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000)
    : null;
}

/**
 * Normalise a Razorpay subscription entity. Exported because the webhook route
 * receives the same entity shape inside the event payload and must interpret it
 * identically to the workers — the Stripe path's "one status map, shared by
 * receiver and reconciler" discipline, applied here.
 */
export function normalizeRazorpaySubscription(
  subscription: RazorpaySubscriptionEntity,
): NormalizedSubscription {
  const endedAt = toDate(subscription.ended_at);

  return {
    id: subscription.id,
    status: mapRazorpayStatus(subscription.status),
    rawStatus: subscription.status,
    isTerminal: RAZORPAY_TERMINAL_STATUSES.has(subscription.status),
    currentPeriodEnd: toDate(subscription.current_end),
    endsAt: endedAt,
    // Razorpay has no separate "cancelled at" timestamp; `ended_at` is set when
    // a subscription is cancelled midway or completes its term.
    canceledAt: subscription.status === 'cancelled' ? endedAt : null,
    planExternalId: subscription.plan_id ?? null,
    customerId: subscription.customer_id ?? null,
  };
}

/** Razorpay reports a genuinely absent object as HTTP 400/404 with this code. */
function isNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number | string; error?: { code?: string; description?: string } };
  const status = Number(e?.statusCode);
  if (status === 404) return true;
  // A malformed/unknown subscription ID comes back as 400 BAD_REQUEST_ERROR
  // with a description naming the id. Treating any 400 as "gone" would be
  // wrong, so this is deliberately narrow: only an explicit does-not-exist.
  return (
    status === 400 &&
    /does not exist|not a valid id|no such/i.test(e?.error?.description ?? '')
  );
}

export class RazorpayProvider implements PaymentProviderAdapter {
  readonly name = 'razorpay' as const;
  readonly enumValue: PaymentProviderEnum = 'RAZORPAY';

  isConfigured(): boolean {
    const id = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    return Boolean(
      id && secret && !id.includes('placeholder') && !id.includes('YOUR'),
    );
  }

  planExternalId(plan: Plan): string | null {
    return plan.razorpayPlanId;
  }

  planWhereExternalId(externalId: string) {
    return { razorpayPlanId: externalId };
  }

  async createCheckout(args: CreateCheckoutArgs): Promise<CheckoutHandoff> {
    const planId = this.planExternalId(args.plan);
    if (!planId) {
      throw new Error(`Plan "${args.plan.name}" has no Razorpay plan configured`);
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) {
      throw new Error('RAZORPAY_KEY_ID is not configured');
    }

    const subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: RAZORPAY_TOTAL_BILLING_CYCLES,
      // Razorpay sends its own payment/renewal emails. Left on so a customer
      // is never left without a receipt if Dharma's mailer is down.
      customer_notify: 1,
      quantity: 1,
      // THE metadata line. `notes` set here land on the subscription entity
      // that every subsequent webhook delivers, which is what makes the org
      // resolvable. Values must be strings/numbers — Razorpay rejects objects.
      notes: {
        organizationId: args.organizationId,
        organizationName: args.organizationName,
        planName: args.plan.name,
      },
    });

    return {
      kind: 'modal',
      provider: 'razorpay',
      reference: subscription.id,
      subscriptionId: subscription.id,
      keyId,
      prefill: {
        name: args.customerName,
        email: args.customerEmail,
      },
      description: `${args.plan.displayName} plan — ${args.organizationName}`,
    };
  }

  async getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null> {
    try {
      const subscription = await razorpay.subscriptions.fetch(subscriptionId);
      return normalizeRazorpaySubscription(
        subscription as unknown as RazorpaySubscriptionEntity,
      );
    } catch (err) {
      // Gone (null) vs unreachable (throw) — the dunning sweep downgrades on
      // the first and deliberately skips on the second.
      if (isNotFound(err)) return null;
      throw new ProviderUnreachableError('razorpay', err);
    }
  }

  async updateSubscription(
    subscriptionId: string,
    planExternalId: string,
  ): Promise<NormalizedSubscription> {
    const updated = await razorpay.subscriptions.update(subscriptionId, {
      plan_id: planExternalId,
      // Apply immediately, matching the Stripe path's behaviour so an upgrade
      // grants access at once rather than at the next cycle boundary.
      schedule_change_at: 'now',
    });
    return normalizeRazorpaySubscription(
      updated as unknown as RazorpaySubscriptionEntity,
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<NormalizedSubscription> {
    // `false` = cancel immediately, matching Stripe's subscriptions.cancel().
    // The caller (billing router / dunning sweep) is what decides the org falls
    // back to Free, so a deferred cancellation here would desynchronise the two.
    const cancelled = await razorpay.subscriptions.cancel(subscriptionId, false);
    return normalizeRazorpaySubscription(
      cancelled as unknown as RazorpaySubscriptionEntity,
    );
  }

  async listInvoices(args: ListInvoicesArgs): Promise<NormalizedInvoice[]> {
    // Subscription-scoped where possible: it is the tighter filter, and an org
    // that changed subscriptions should still see the current one's history.
    // Falls back to customer scope so invoices survive a cancellation.
    const query = args.subscriptionId
      ? { subscription_id: args.subscriptionId, count: args.limit ?? 24 }
      : args.customerId
        ? { customer_id: args.customerId, count: args.limit ?? 24 }
        : null;

    // No provider identifiers yet means an empty history, not an error.
    if (!query) return [];

    const response = await razorpay.invoices.all(query);

    return (response.items ?? []).map((invoice) => {
      const amount = Number(invoice.amount ?? 0);
      const amountPaid = Number(invoice.amount_paid ?? 0);

      return {
        id: invoice.id,
        number: invoice.invoice_number ?? null,
        status: invoice.status ?? null,
        // Razorpay reports the total and the paid portion; "due" is the
        // remainder. Stripe reports amount_due directly, so this keeps both
        // adapters returning the same meaning for the same field name.
        amountDue: Math.max(amount - amountPaid, 0),
        amountPaid,
        currency: invoice.currency ?? 'INR',
        createdAt: new Date(Number(invoice.created_at ?? 0) * 1000),
        hostedInvoiceUrl: invoice.short_url ?? null,
        // Razorpay's API does not return a direct PDF link on the invoice
        // entity — the PDF is behind short_url. Returning null (rather than
        // reusing short_url) keeps the Download-PDF control absent instead of
        // offering a button that opens a web page, per the "no control that
        // cannot do what it says" standard set in BillingHistory.
        invoicePdf: null,
      };
    });
  }

  async createPortalSession(): Promise<{ url: string } | null> {
    // Razorpay has no hosted Billing Portal. Null is the honest answer and the
    // UI renders the in-app management screen instead — see BillingManage.tsx.
    return null;
  }

  /**
   * Verify the handler response Checkout.js hands the browser after a
   * successful subscription authorisation.
   *
   * A DIFFERENT scheme from the webhook one and it must not be confused with
   * it: the signed payload is `payment_id|subscription_id` and the key is the
   * API KEY SECRET, not the webhook secret. Lives on the adapter rather than in
   * the router so no caller above this boundary touches the SDK.
   *
   * Passing this proves the response came from Razorpay. It does NOT prove what
   * was purchased — the caller must still re-read the subscription server-side
   * before granting anything.
   */
  verifySubscriptionPayment(args: {
    paymentId: string;
    subscriptionId: string;
    signature: string;
  }): boolean {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) return false;

    try {
      // `require` rather than a dynamic `import`: this is a CommonJS module
      // with no static export shape ESM interop can be relied on to expose,
      // and a payments verification path is the wrong place to depend on
      // cjs-module-lexer guessing correctly.
      const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils') as {
        validatePaymentVerification: (
          payload: { payment_id: string; subscription_id: string },
          signature: string,
          secret: string,
        ) => boolean;
      };

      return validatePaymentVerification(
        { payment_id: args.paymentId, subscription_id: args.subscriptionId },
        args.signature,
        keySecret,
      );
    } catch {
      // A malformed signature can make the helper throw rather than return
      // false; unverifiable is unverifiable either way.
      return false;
    }
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
    const signature = headers.get(RAZORPAY_SIGNATURE_HEADER);
    if (!signature) return { valid: false, reason: 'missing-signature' };

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return { valid: false, reason: 'not-configured' };

    try {
      // HMAC-SHA256 over the RAW body with the webhook secret. This is a
      // different scheme from Stripe's timestamped v1 signature — do not
      // reason about one from the other. The SDK's own helper is used rather
      // than a hand-rolled HMAC so the comparison stays whatever Razorpay
      // considers correct.
      const { validateWebhookSignature } = require('razorpay/dist/utils/razorpay-utils') as {
        validateWebhookSignature: (body: string, signature: string, secret: string) => boolean;
      };
      return validateWebhookSignature(rawBody, signature, secret)
        ? { valid: true }
        : { valid: false, reason: 'invalid-signature' };
    } catch {
      // A malformed signature can make the helper throw rather than return
      // false; an unverifiable payload is invalid either way.
      return { valid: false, reason: 'invalid-signature' };
    }
  }
}
