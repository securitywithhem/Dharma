// Phase 3c — the payment-provider boundary.
//
// WHY THIS EXISTS: Stripe is invite-only for India-based accounts and cannot be
// activated for real sales, so Razorpay is the live provider. Stripe is not
// deleted — it remains a legitimate option for international customers — so
// rather than swapping one SDK for another, everything above the provider (the
// tRPC router, the reconciliation and dunning workers, entitlements, the audit
// trail) talks to this interface and never to a vendor SDK.
//
// The method set was derived from the real call sites that existed before the
// migration, not invented up front:
//   src/server/routers/billing.ts      → checkout, portal, invoices, update, cancel, retrieve
//   src/app/api/webhooks/stripe/route.ts → signature verification
//   .../workers/billingReconciliationWorker.ts → retrieve + status mapping
//   .../workers/dunningWorker.ts               → retrieve
//
// Anything provider-specific is normalised here so callers never branch on the
// provider name. The one place that genuinely cannot be normalised is the
// checkout handoff: Stripe redirects to a hosted page, Razorpay opens an
// in-page modal. That difference is modelled explicitly (see CheckoutHandoff)
// rather than papered over, because pretending Razorpay returns a redirect URL
// would produce a checkout flow that silently does nothing.

import type { PaymentProvider as PaymentProviderEnum, Plan } from '@prisma/client';

export type ProviderName = 'stripe' | 'razorpay';

/** Dharma's own subscription status vocabulary (packages/db/schema.prisma). */
export type DharmaSubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'PAUSED';

export const PROVIDER_ENUM: Record<ProviderName, PaymentProviderEnum> = {
  stripe: 'STRIPE',
  razorpay: 'RAZORPAY',
};

/**
 * A subscription as Dharma understands it, with every provider quirk already
 * resolved: statuses mapped onto Dharma's enum, Unix seconds turned into Dates,
 * and the provider's plan/price identifier surfaced under one name.
 */
export interface NormalizedSubscription {
  id: string;
  /** Mapped onto Dharma's enum. Callers must not re-map. */
  status: DharmaSubscriptionStatus;
  /** The provider's own status string, kept for audit metadata and logging. */
  rawStatus: string;
  /** True only for statuses the customer cannot recover from. */
  isTerminal: boolean;
  currentPeriodEnd: Date | null;
  /** When the subscription is scheduled to end, if a cancellation is pending. */
  endsAt: Date | null;
  canceledAt: Date | null;
  /** Stripe Price ID or Razorpay Plan ID — whichever identifies the plan sold. */
  planExternalId: string | null;
  customerId: string | null;
}

export interface NormalizedInvoice {
  id: string;
  number: string | null;
  status: string | null;
  /** Minor units (paise/cents), matching both providers' native representation. */
  amountDue: number;
  amountPaid: number;
  currency: string;
  createdAt: Date;
  /** A page the customer can view the invoice on, if the provider offers one. */
  hostedInvoiceUrl: string | null;
  /** A direct PDF link, if and only if the provider actually returned one. */
  invoicePdf: string | null;
}

/**
 * What the frontend needs to actually start paying.
 *
 * `kind` is the honest difference between the two providers and the reason this
 * is a union rather than `{ url: string }`:
 *
 *  - `redirect` (Stripe): navigate the browser to a provider-hosted page.
 *  - `modal` (Razorpay): the subscription already exists server-side; the
 *    browser opens Razorpay's Checkout.js over the current page with these
 *    parameters and the customer authorises the mandate inside it.
 */
export type CheckoutHandoff =
  | {
      kind: 'redirect';
      provider: 'stripe';
      /** Provider-side object this checkout created, for the audit record. */
      reference: string;
      url: string | null;
    }
  | {
      kind: 'modal';
      provider: 'razorpay';
      reference: string;
      subscriptionId: string;
      /** Publishable key ID. Safe to send to the browser; the secret is not. */
      keyId: string;
      /** Display-only; Razorpay pre-fills its own form with these. */
      prefill: { name?: string; email?: string };
      /** Shown as the merchant name inside the modal. */
      description: string;
    };

export interface CreateCheckoutArgs {
  organizationId: string;
  organizationName: string;
  plan: Plan;
  customerEmail?: string;
  customerName?: string;
  /** Only meaningful for redirect-style providers; ignored by modal ones. */
  successUrl: string;
  cancelUrl: string;
  /** Reuse an existing provider customer where the provider has that concept. */
  existingCustomerId?: string | null;
}

export interface ListInvoicesArgs {
  customerId?: string | null;
  subscriptionId?: string | null;
  limit?: number;
}

/**
 * Result of verifying an inbound webhook. Deliberately does NOT carry a parsed
 * event type union: each provider's route handler translates its own payload
 * into calls on the shared billing lifecycle service, so a single leaky
 * "universal event" type would buy nothing and hide real differences.
 */
export type WebhookVerification =
  | { valid: true }
  | { valid: false; reason: 'missing-signature' | 'invalid-signature' | 'not-configured' };

/**
 * Thrown by a provider adapter when it can prove the subscription no longer
 * exists at the provider (Stripe `resource_missing`, Razorpay 404), as opposed
 * to the provider merely being unreachable.
 *
 * The distinction is load-bearing: the dunning sweep downgrades on "gone" and
 * deliberately SKIPS on "unreachable", because cutting off a paying customer
 * over a network blip is the worse error. Adapters must never conflate them —
 * `getSubscription` returns null for gone and throws for unreachable.
 */
export class ProviderUnreachableError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly cause: unknown,
  ) {
    super(`Payment provider "${provider}" was unreachable`);
    this.name = 'ProviderUnreachableError';
  }
}

export interface PaymentProviderAdapter {
  readonly name: ProviderName;
  /** The Prisma enum value, so callers can persist the provider without a map. */
  readonly enumValue: PaymentProviderEnum;

  /** True when the adapter has real credentials, not just import-time stubs. */
  isConfigured(): boolean;

  /**
   * The identifier this provider sells `plan` under, or null when the plan is
   * not sellable here (e.g. the free tier, or a plan only wired up in Stripe).
   */
  planExternalId(plan: Plan): string | null;

  /** Find a local Plan by the provider's own identifier. Webhook-side lookup. */
  planWhereExternalId(externalId: string): Record<string, string>;

  createCheckout(args: CreateCheckoutArgs): Promise<CheckoutHandoff>;

  /**
   * @returns the subscription, or `null` when the provider confirms it no
   *   longer exists.
   * @throws ProviderUnreachableError when the answer could not be obtained.
   */
  getSubscription(subscriptionId: string): Promise<NormalizedSubscription | null>;

  updateSubscription(
    subscriptionId: string,
    planExternalId: string,
  ): Promise<NormalizedSubscription>;

  cancelSubscription(subscriptionId: string): Promise<NormalizedSubscription>;

  listInvoices(args: ListInvoicesArgs): Promise<NormalizedInvoice[]>;

  /**
   * A provider-hosted management page, when one exists. Stripe has a Billing
   * Portal; Razorpay has no equivalent, which is exactly why Dharma ships its
   * own self-serve management screen (see BillingManage.tsx). Returning null
   * means "this provider has no portal", not "an error occurred", so the UI can
   * render the in-app screen instead of a broken button.
   */
  createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<{ url: string } | null>;

  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification;
}
