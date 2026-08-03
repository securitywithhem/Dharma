import Stripe from 'stripe';

// Placeholder fallback: the constructor must not throw at module import —
// `next build` executes this module while collecting page data for routes
// that (transitively) import the app router, in environments with no Stripe
// config. Real billing calls fail with an auth error if the key is unset.
const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder_module_import_only',
  {
    apiVersion: '2026-06-24.dahlia',
  }
);

export default stripe;

// Helper function to create a checkout session
export async function createCheckoutSession(
  organizationId: string,
  stripePriceId: string,
  successUrl: string,
  cancelUrl: string,
  customerEmail?: string
) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer_email: customerEmail,
    line_items: [
      {
        price: stripePriceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      organizationId,
    },
    // Checkout Session metadata does NOT propagate to the Subscription object
    // Stripe creates from it. The webhook resolves the org from
    // `subscription.metadata.organizationId`, so without this block every
    // customer.subscription.* event arrives with no org and the plan is never
    // applied. subscription_data.metadata is the only way to stamp it.
    subscription_data: {
      metadata: {
        organizationId,
      },
    },
  });
  return session;
}

/**
 * Stripe-hosted Billing Portal: payment-method updates, cancellation, and
 * invoice downloads. Deliberately not re-implemented in-app — Stripe's portal
 * is PCI-scoped and already handles the flows correctly.
 */
export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string
) {
  return stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
}

/** Invoice history for the Billing page, read straight from Stripe. */
export async function listInvoices(stripeCustomerId: string, limit = 24) {
  const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit,
  });
  return invoices.data;
}

/**
 * Map a Stripe subscription status onto Dharma's SubscriptionStatus enum.
 *
 * Shared by the webhook receiver and the reconciliation worker so the two can
 * never disagree about what a given Stripe status means. `incomplete`/`unpaid`
 * map to PAST_DUE rather than CANCELED: the customer can still recover them,
 * and termination is the dunning sweep's decision alone.
 */
export function mapStripeStatus(
  status: string
): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'PAUSED' {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    default:
      return 'CANCELED';
  }
}

// Helper to update subscription
export async function updateSubscription(
  subscriptionId: string,
  stripePriceId: string
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const updatedSubscription = await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [
        {
          id: subscription.items.data[0].id,
          price: stripePriceId,
        },
      ],
    }
  );
  return updatedSubscription;
}

// Helper to cancel subscription
export async function cancelSubscription(subscriptionId: string) {
  const subscription = await stripe.subscriptions.cancel(subscriptionId);
  return subscription;
}
