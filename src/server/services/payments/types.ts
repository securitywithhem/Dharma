// Razorpay billing domain types.
//
// Razorpay is the sole payment provider. These types exist to keep provider
// quirks (Unix-second timestamps, minor-unit amounts, Razorpay's own status
// vocabulary) normalised at the edge, so the tRPC router, the reconciliation
// and dunning workers, entitlements and the audit trail all speak one shape.
//
// This is NOT a provider abstraction: there is no adapter interface and no
// provider selection. See ./index.ts for why that is deliberate.

import type { Plan } from '@prisma/client';

/** Dharma's own subscription status vocabulary (packages/db/schema.prisma). */
export type DharmaSubscriptionStatus =
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'PAUSED';

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
  /** The Razorpay Plan ID this subscription is sold under. */
  planExternalId: string | null;
  customerId: string | null;
}

export interface NormalizedInvoice {
  id: string;
  number: string | null;
  status: string | null;
  /** Minor units (paise), matching Razorpay's native representation. */
  amountDue: number;
  amountPaid: number;
  currency: string;
  createdAt: Date;
  /** A page the customer can view the invoice on, when Razorpay returns one. */
  hostedInvoiceUrl: string | null;
  /** A direct PDF link, if and only if Razorpay actually returned one. */
  invoicePdf: string | null;
}

/**
 * What the frontend needs to actually start paying.
 *
 * Razorpay's subscription flow has no hosted page to redirect to: the
 * subscription is created server-side and the browser opens Checkout.js over
 * the current page with these parameters, where the customer authorises the
 * mandate. `kind: 'modal'` is retained as a single-member discriminant so the
 * shape stays self-describing at the call site and the frontend keeps its
 * exhaustive switch — it is one line, not a provider abstraction.
 */
export type CheckoutHandoff = {
  kind: 'modal';
  /** Provider-side object this checkout created, for the audit record. */
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
  /** Reuse an existing Razorpay customer rather than creating a duplicate. */
  existingCustomerId?: string | null;
}

export interface ListInvoicesArgs {
  customerId?: string | null;
  subscriptionId?: string | null;
  limit?: number;
}

/**
 * Result of verifying an inbound webhook. Deliberately does NOT carry a parsed
 * event type union: the route handler translates Razorpay's payload into calls
 * on the billing lifecycle service, and a second "universal event" type would
 * only duplicate that translation.
 */
export type WebhookVerification =
  | { valid: true }
  | { valid: false; reason: 'missing-signature' | 'invalid-signature' | 'not-configured' };

/**
 * Thrown when Razorpay could not be reached, as opposed to Razorpay confirming
 * the subscription is gone (a 404, or a 400 that names the id as invalid).
 *
 * The distinction is load-bearing: the dunning sweep downgrades on "gone" and
 * deliberately SKIPS on "unreachable", because cutting off a paying customer
 * over a network blip is the worse error. Never conflate them —
 * `getSubscription` returns null for gone and throws this for unreachable.
 */
export class ProviderUnreachableError extends Error {
  constructor(readonly cause: unknown) {
    super('Razorpay was unreachable');
    this.name = 'ProviderUnreachableError';
  }
}
