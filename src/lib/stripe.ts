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
  });
  return session;
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
