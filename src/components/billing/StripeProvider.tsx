"use client";

import React from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

// Lazily created on first render rather than at module scope: loadStripe()
// injects the js.stripe.com <script> the moment it is called, so a
// module-level call made every route that merely imported this file pull
// Stripe's SDK. Memoised in a module singleton so remounts reuse one script.
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
    );
  }
  return stripePromise;
}

export function StripeProvider({ children }: { children: React.ReactNode }) {
  const stripe = React.useMemo(() => getStripe(), []);

  return (
    <Elements stripe={stripe}>
      {children}
    </Elements>
  );
}
