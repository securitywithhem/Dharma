// Phase 3c — provider resolution.
//
// One switch, resolved from the environment, consulted by the tRPC router and
// the workers. Nothing above this module imports a vendor SDK.

import type { PaymentProvider as PaymentProviderEnum } from '@prisma/client';
import { RazorpayProvider } from './razorpayProvider';
import { StripeProvider } from './stripeProvider';
import type { PaymentProviderAdapter, ProviderName } from './provider';

export * from './provider';
export { StripeProvider } from './stripeProvider';
export { RazorpayProvider } from './razorpayProvider';

// Instantiated once at module load. Both constructors are side-effect free and
// read env lazily, so holding both costs nothing and keeps the dormant Stripe
// path callable for orgs still billed through it.
const adapters: Record<ProviderName, PaymentProviderAdapter> = {
  stripe: new StripeProvider(),
  razorpay: new RazorpayProvider(),
};

/**
 * The provider new subscriptions are sold through.
 *
 * Defaults to Razorpay: Stripe is invite-only for India-based accounts and
 * cannot be activated for real sales, so a deployment that forgets to set
 * PAYMENT_PROVIDER should land on the one that actually works rather than on
 * a checkout that fails at the payment step.
 */
export function activeProviderName(): ProviderName {
  const configured = process.env.PAYMENT_PROVIDER?.toLowerCase();
  return configured === 'stripe' ? 'stripe' : 'razorpay';
}

/** The adapter used for new checkouts. */
export function getPaymentProvider(): PaymentProviderAdapter {
  return adapters[activeProviderName()];
}

/**
 * The adapter for an organization that ALREADY has a subscription.
 *
 * Distinct from getPaymentProvider() on purpose. An org that subscribed through
 * Stripe must keep being reconciled, dunned, and cancelled through Stripe even
 * after this deployment switches its default to Razorpay — routing its
 * cancellation through the active provider would look up a Stripe subscription
 * ID in Razorpay, fail, and leave a customer billed for a plan they cancelled.
 *
 * Falls back to the active provider only when the org has no recorded provider
 * (i.e. has never paid), where the fallback is what it will use next.
 */
export function providerFor(
  organization: { paymentProvider: PaymentProviderEnum | null },
): PaymentProviderAdapter {
  switch (organization.paymentProvider) {
    case 'STRIPE':
      return adapters.stripe;
    case 'RAZORPAY':
      return adapters.razorpay;
    default:
      return getPaymentProvider();
  }
}

/** Adapter lookup by Prisma enum, for worker queries that group by provider. */
export function providerByEnum(
  value: PaymentProviderEnum,
): PaymentProviderAdapter {
  return value === 'STRIPE' ? adapters.stripe : adapters.razorpay;
}
