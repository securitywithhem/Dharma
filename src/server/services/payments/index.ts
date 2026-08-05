// The payments module.
//
// Razorpay is the sole payment provider. There is deliberately no provider
// selection here — no `getPaymentProvider()`, no `providerFor(org)`, no
// `PAYMENT_PROVIDER` switch. Stripe was removed in full rather than left
// dormant behind an interface, because it is invite-only for India-based
// accounts and can never be activated for real sales; a second implementation
// that can never run is not portability, it is untested code that every future
// change has to keep compiling.
//
// Callers import `razorpayProvider` and use it directly. If a second provider
// is ever genuinely needed, reintroducing the boundary is a smaller job than
// carrying it unused until then — and the normalisation types below (which are
// the part that actually earned their keep) survive that change unchanged.

import { RazorpayProvider } from './razorpayProvider';

export * from './types';
export { RazorpayProvider } from './razorpayProvider';

/**
 * The single Razorpay service instance.
 *
 * Constructed once at module load: the constructor is side-effect free and
 * reads credentials lazily per call, so holding it costs nothing and it stays
 * safe to import from route modules that `next build` evaluates in
 * environments with no Razorpay configuration present.
 */
export const razorpayProvider = new RazorpayProvider();
