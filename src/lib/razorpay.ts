// Phase 3c — Razorpay SDK client and status mapping.
//
// Mirrors src/lib/stripe.ts deliberately, including the placeholder fallback:
// the constructor must not throw at module import, because `next build`
// executes this module while collecting page data for routes that transitively
// import the app router, in environments with no Razorpay config. Real billing
// calls fail with an auth error if the keys are unset — which is the correct
// and visible failure, unlike a build that cannot complete.

import Razorpay from 'razorpay';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID ?? 'rzp_test_placeholder_module_import_only',
  key_secret: process.env.RAZORPAY_KEY_SECRET ?? 'placeholder_module_import_only',
});

export default razorpay;

/**
 * Map a Razorpay subscription status onto Dharma's SubscriptionStatus enum.
 *
 * Shared by the webhook receiver, the reconciliation worker and the dunning
 * worker so the three can never disagree, exactly as mapStripeStatus is.
 *
 * The mapping is NOT a transliteration of the Stripe one — Razorpay's lifecycle
 * genuinely differs:
 *
 *  - `created` / `authenticated`: the subscription exists but the customer has
 *    not been charged yet (mandate authorised, first debit pending). Mapping
 *    these to ACTIVE would hand out paid entitlements before any money moved.
 *    They map to PAST_DUE — access is not yet granted, and the dunning clock
 *    is only started by an actual payment failure, so nothing downgrades on
 *    this alone.
 *  - `pending`: a charge failed and Razorpay is retrying. Recoverable → PAST_DUE.
 *  - `halted`: Razorpay gave up retrying. Still recoverable by the customer
 *    updating their method, so PAST_DUE rather than CANCELED — termination is
 *    the dunning sweep's decision alone, matching the Stripe path.
 *  - `paused`: PAUSED.
 *  - `cancelled` / `completed` / `expired`: terminal → CANCELED.
 */
export function mapRazorpayStatus(
  status: string,
): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'PAUSED' {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'created':
    case 'authenticated':
    case 'pending':
    case 'halted':
      return 'PAST_DUE';
    case 'paused':
      return 'PAUSED';
    default:
      return 'CANCELED';
  }
}

/** Statuses the customer can no longer recover from without re-subscribing. */
export const RAZORPAY_TERMINAL_STATUSES = new Set([
  'cancelled',
  'completed',
  'expired',
]);
