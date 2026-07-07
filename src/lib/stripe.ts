import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2026-06-24.dahlia',
});

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
