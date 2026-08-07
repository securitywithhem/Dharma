"use client";

// Phase 3c — Razorpay Checkout.js loader and modal driver.
//
// The script is fetched on FIRST USE, not at module scope and not from the app
// shell. A module-level or globally-mounted loader makes every
// route in the product pull a third-party payment script it will never use,
// which is both a performance cost and an unnecessary widening of the origins
// every page talks to. Only the Billing route calls this hook, so only the
// Billing route loads checkout.js.
//
// Memoised in a module singleton so remounts and repeated upgrade attempts
// reuse one script tag rather than stacking them.

import { useCallback, useRef, useState } from "react";

const CHECKOUT_JS_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let checkoutScript: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (checkoutScript) return checkoutScript;

  checkoutScript = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Razorpay Checkout can only load in the browser"));
      return;
    }

    // Another mount may have inserted the tag already (or a prior load failed
    // and cleared the memo) — reuse the DOM node rather than duplicating it.
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_JS_SRC}"]`,
    );
    if (existing && window.Razorpay) {
      resolve();
      return;
    }

    const script = existing ?? document.createElement("script");
    script.src = CHECKOUT_JS_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      // Clear the memo so a later retry can genuinely re-attempt instead of
      // resolving against a permanently rejected promise.
      checkoutScript = null;
      reject(new Error("Could not load Razorpay Checkout"));
    });

    if (!existing) document.body.appendChild(script);
  });

  return checkoutScript;
}

/** The subset of Razorpay's client options this flow uses. */
export interface RazorpayCheckoutParams {
  keyId: string;
  subscriptionId: string;
  description: string;
  prefill: { name?: string; email?: string };
}

/** What Razorpay's handler hands back on a successful authorisation. */
export interface RazorpayCheckoutResult {
  razorpayPaymentId: string;
  razorpaySubscriptionId: string;
  razorpaySignature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      close?: () => void;
      on?: (event: string, handler: (payload: unknown) => void) => void;
    };
  }
}

export function useRazorpayCheckout() {
  const [isOpening, setIsOpening] = useState(false);
  // Guards against a second modal being opened while one is already up, which
  // would create two live authorisation attempts against one subscription.
  const openRef = useRef(false);

  /**
   * Opens the modal and resolves with Razorpay's confirmation, or null if the
   * customer dismissed it.
   *
   * The resolved values are NOT proof of payment and must not be used to grant
   * anything client-side — they are passed to billing.confirmCheckout, which
   * verifies the signature server-side and re-reads the subscription from
   * Razorpay. The webhook remains the source of truth.
   */
  const open = useCallback(
    async (params: RazorpayCheckoutParams): Promise<RazorpayCheckoutResult | null> => {
      if (openRef.current) return null;
      openRef.current = true;
      setIsOpening(true);

      try {
        await loadCheckoutScript();

        if (!window.Razorpay) {
          throw new Error("Razorpay Checkout did not initialise");
        }

        return await new Promise<RazorpayCheckoutResult | null>((resolve, reject) => {
          const checkout = new window.Razorpay!({
            key: params.keyId,
            subscription_id: params.subscriptionId,
            name: "Dharma",
            description: params.description,
            prefill: {
              name: params.prefill.name ?? "",
              email: params.prefill.email ?? "",
            },
            handler: (response: {
              razorpay_payment_id: string;
              razorpay_subscription_id: string;
              razorpay_signature: string;
            }) => {
              resolve({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySubscriptionId: response.razorpay_subscription_id,
                razorpaySignature: response.razorpay_signature,
              });
            },
            modal: {
              // Dismissal is a normal outcome, not an error: the customer
              // changed their mind and their plan is simply unchanged.
              ondismiss: () => resolve(null),
            },
          });

          checkout.on?.("payment.failed", (payload) => {
            const description =
              (payload as { error?: { description?: string } })?.error?.description ??
              "The payment could not be completed.";
            reject(new Error(description));
          });

          checkout.open();
        });
      } finally {
        openRef.current = false;
        setIsOpening(false);
      }
    },
    [],
  );

  return { open, isOpening };
}
