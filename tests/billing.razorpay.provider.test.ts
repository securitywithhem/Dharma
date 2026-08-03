// Phase 3c — RazorpayProvider adapter tests.
//
// These cover the adapter's own contract: status normalisation, the
// gone-vs-unreachable distinction the dunning sweep depends on, invoice
// normalisation, and provider selection. No network is involved — the SDK
// surface is stubbed and the assertions are about how this codebase interprets
// Razorpay's shapes, which is where the risk actually lives.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import type { Plan } from "@prisma/client";

const WEBHOOK_SECRET = "rzp_whsec_provider_spec";
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

// Stub the SDK singleton. Static-importing the real module here would let the
// suite reach the network (see the note in billing.razorpay.webhook.test.ts),
// so the provider is loaded dynamically in beforeAll, after this mock.
// Typed as an unconstrained async fn: @jest/globals infers `never` for a bare
// jest.fn(), which makes every mockResolvedValueOnce a type error.
type AnyAsyncMock = (...args: unknown[]) => Promise<unknown>;
const fetchSubscription = jest.fn<AnyAsyncMock>();
const cancelSubscription = jest.fn<AnyAsyncMock>();
const allInvoices = jest.fn<AnyAsyncMock>();

jest.mock("@/lib/razorpay", () => {
  const actual = jest.requireActual("@/lib/razorpay") as Record<string, unknown>;
  return {
    ...actual,
    __esModule: true,
    default: {
      subscriptions: {
        fetch: (...a: unknown[]) => (fetchSubscription as (...x: unknown[]) => unknown)(...a),
        cancel: (...a: unknown[]) => (cancelSubscription as (...x: unknown[]) => unknown)(...a),
      },
      invoices: {
        all: (...a: unknown[]) => (allInvoices as (...x: unknown[]) => unknown)(...a),
      },
    },
  };
});

let RazorpayProvider: new () => import("@/server/services/payments/provider").PaymentProviderAdapter;
let normalizeRazorpaySubscription: typeof import("@/server/services/payments/razorpayProvider").normalizeRazorpaySubscription;
let mapRazorpayStatus: typeof import("@/lib/razorpay").mapRazorpayStatus;
let ProviderUnreachableError: typeof import("@/server/services/payments/provider").ProviderUnreachableError;

let provider: import("@/server/services/payments/provider").PaymentProviderAdapter;

beforeAll(async () => {
  const mod = await import("@/server/services/payments/razorpayProvider");
  RazorpayProvider = mod.RazorpayProvider;
  normalizeRazorpaySubscription = mod.normalizeRazorpaySubscription;

  ({ mapRazorpayStatus } = await import("@/lib/razorpay"));
  ({ ProviderUnreachableError } = await import(
    "@/server/services/payments/provider"
  ));

  provider = new RazorpayProvider();
});

function planFixture(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "plan_local_1",
    name: "pro",
    displayName: "Pro",
    stripePriceId: "price_stripe_pro",
    razorpayPlanId: "plan_rzp_pro",
    price: 8000,
    currency: "INR",
    limits: {},
    features: {},
    isPublic: true,
    createdAt: new Date(),
    ...overrides,
  } as Plan;
}

describe("status mapping", () => {
  it("maps only `active` to ACTIVE", () => {
    expect(mapRazorpayStatus("active")).toBe("ACTIVE");
  });

  it("does NOT grant access before the first successful charge", () => {
    // `created` and `authenticated` mean the mandate exists but no money has
    // moved. Mapping them to ACTIVE would hand out paid entitlements for free.
    expect(mapRazorpayStatus("created")).toBe("PAST_DUE");
    expect(mapRazorpayStatus("authenticated")).toBe("PAST_DUE");
  });

  it("keeps recoverable failure states out of CANCELED", () => {
    // Termination is the dunning sweep's decision alone, matching Stripe.
    expect(mapRazorpayStatus("pending")).toBe("PAST_DUE");
    expect(mapRazorpayStatus("halted")).toBe("PAST_DUE");
  });

  it("maps terminal states to CANCELED", () => {
    expect(mapRazorpayStatus("cancelled")).toBe("CANCELED");
    expect(mapRazorpayStatus("completed")).toBe("CANCELED");
    expect(mapRazorpayStatus("expired")).toBe("CANCELED");
  });

  it("maps paused to PAUSED and anything unknown to CANCELED", () => {
    expect(mapRazorpayStatus("paused")).toBe("PAUSED");
    expect(mapRazorpayStatus("something_new_razorpay_added")).toBe("CANCELED");
  });
});

describe("subscription normalisation", () => {
  it("converts Unix seconds to Dates and surfaces the plan identifier", () => {
    const endSeconds = 1893456000;
    const normalized = normalizeRazorpaySubscription({
      id: "sub_1",
      status: "active",
      plan_id: "plan_rzp_pro",
      customer_id: "cust_1",
      current_end: endSeconds,
      ended_at: null,
    });

    expect(normalized.id).toBe("sub_1");
    expect(normalized.status).toBe("ACTIVE");
    expect(normalized.rawStatus).toBe("active");
    expect(normalized.isTerminal).toBe(false);
    expect(normalized.currentPeriodEnd?.getTime()).toBe(endSeconds * 1000);
    expect(normalized.planExternalId).toBe("plan_rzp_pro");
    expect(normalized.customerId).toBe("cust_1");
  });

  it("treats a zero/absent timestamp as null rather than the epoch", () => {
    const normalized = normalizeRazorpaySubscription({
      id: "sub_2",
      status: "created",
      current_end: 0,
      ended_at: null,
    });
    // Rendering "1 January 1970" as a renewal date would be worse than nothing.
    expect(normalized.currentPeriodEnd).toBeNull();
    expect(normalized.endsAt).toBeNull();
  });

  it("reports canceledAt only for a cancelled subscription", () => {
    const endedAt = 1800000000;
    expect(
      normalizeRazorpaySubscription({
        id: "sub_3",
        status: "completed",
        ended_at: endedAt,
      }).canceledAt,
    ).toBeNull();

    expect(
      normalizeRazorpaySubscription({
        id: "sub_4",
        status: "cancelled",
        ended_at: endedAt,
      }).canceledAt?.getTime(),
    ).toBe(endedAt * 1000);
  });
});

describe("gone vs unreachable", () => {
  // The dunning sweep downgrades on "confirmed gone" and SKIPS on "could not
  // find out". Conflating them either cuts off a paying customer over a network
  // blip, or lets a cancelled org keep paid access forever.
  it("returns null when Razorpay confirms the subscription does not exist", async () => {
    fetchSubscription.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" },
    });
    await expect(provider.getSubscription("sub_gone")).resolves.toBeNull();
  });

  it("returns null on a 404", async () => {
    fetchSubscription.mockRejectedValueOnce({ statusCode: 404, error: {} });
    await expect(provider.getSubscription("sub_404")).resolves.toBeNull();
  });

  it("throws ProviderUnreachableError on a network or server fault", async () => {
    fetchSubscription.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(provider.getSubscription("sub_down")).rejects.toBeInstanceOf(
      ProviderUnreachableError,
    );
  });

  it("does NOT treat every 400 as gone", async () => {
    // A generic validation error is not proof the subscription vanished.
    fetchSubscription.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" },
    });
    await expect(provider.getSubscription("sub_badreq")).rejects.toBeInstanceOf(
      ProviderUnreachableError,
    );
  });
});

describe("invoice normalisation", () => {
  it("reports amountDue as the unpaid remainder, matching Stripe's meaning", async () => {
    allInvoices.mockResolvedValueOnce({
      items: [
        {
          id: "inv_1",
          invoice_number: "INV-0001",
          status: "partially_paid",
          amount: 800000,
          amount_paid: 300000,
          currency: "INR",
          created_at: 1800000000,
          short_url: "https://rzp.io/i/abc",
        },
      ],
    });

    const [invoice] = await provider.listInvoices({ subscriptionId: "sub_1" });
    expect(invoice.amountDue).toBe(500000);
    expect(invoice.amountPaid).toBe(300000);
    expect(invoice.currency).toBe("INR");
    expect(invoice.hostedInvoiceUrl).toBe("https://rzp.io/i/abc");
  });

  it("returns no PDF link, because Razorpay does not provide one", async () => {
    allInvoices.mockResolvedValueOnce({
      items: [
        {
          id: "inv_2",
          invoice_number: "INV-0002",
          status: "paid",
          amount: 800000,
          amount_paid: 800000,
          currency: "INR",
          created_at: 1800000000,
          short_url: "https://rzp.io/i/def",
        },
      ],
    });

    const [invoice] = await provider.listInvoices({ subscriptionId: "sub_1" });
    // A "Download PDF" button that opens a web page is a lying control.
    expect(invoice.invoicePdf).toBeNull();
  });

  it("returns an empty history rather than calling the API with no identifiers", async () => {
    allInvoices.mockClear();
    await expect(provider.listInvoices({})).resolves.toEqual([]);
    expect(allInvoices).not.toHaveBeenCalled();
  });
});

describe("plan identifiers", () => {
  it("reads the Razorpay plan ID, never the Stripe price ID", () => {
    expect(provider.planExternalId(planFixture())).toBe("plan_rzp_pro");
    // A plan wired up only in Stripe is correctly not sellable here.
    expect(provider.planExternalId(planFixture({ razorpayPlanId: null }))).toBeNull();
  });

  it("looks plans up by the Razorpay column", () => {
    expect(provider.planWhereExternalId("plan_x")).toEqual({ razorpayPlanId: "plan_x" });
  });
});

describe("no hosted portal", () => {
  it("returns null so the UI renders the in-app management screen", async () => {
    // Null means "this provider has no portal", not "an error occurred".
    await expect(provider.createPortalSession("cust_1", "https://x.test")).resolves.toBeNull();
  });
});

describe("webhook signature verification", () => {
  const body = JSON.stringify({ event: "subscription.activated" });

  function headers(record: Record<string, string>) {
    return new Headers(record);
  }

  it("accepts a correctly signed body", () => {
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    expect(
      provider.verifyWebhook(body, headers({ "x-razorpay-signature": signature })),
    ).toEqual({ valid: true });
  });

  it("rejects a missing header", () => {
    expect(provider.verifyWebhook(body, headers({}))).toEqual({
      valid: false,
      reason: "missing-signature",
    });
  });

  it("rejects a signature made with the wrong secret", () => {
    const signature = createHmac("sha256", "wrong").update(body).digest("hex");
    expect(
      provider.verifyWebhook(body, headers({ "x-razorpay-signature": signature })),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("rejects a body altered after signing", () => {
    const signature = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
    const tampered = JSON.stringify({ event: "subscription.cancelled" });
    expect(
      provider.verifyWebhook(tampered, headers({ "x-razorpay-signature": signature })),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("reports not-configured rather than silently accepting when no secret is set", () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      expect(
        provider.verifyWebhook(body, headers({ "x-razorpay-signature": "abc" })),
      ).toEqual({ valid: false, reason: "not-configured" });
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    }
  });
});

describe("subscription payment verification (checkout fast path)", () => {
  // A DIFFERENT scheme from the webhook one: the signed payload is
  // `payment_id|subscription_id` and the key is the API KEY SECRET, not the
  // webhook secret. Confusing the two would either reject every real payment
  // or accept forged ones.
  const paymentId = "pay_spec_1";
  const subscriptionId = "sub_spec_1";
  const KEY_SECRET = "rzp_key_secret_provider_spec";

  function signPayment(secret = KEY_SECRET) {
    return createHmac("sha256", secret)
      .update(`${paymentId}|${subscriptionId}`)
      .digest("hex");
  }

  let rzp: { verifySubscriptionPayment: (a: Record<string, string>) => boolean };
  let savedSecret: string | undefined;

  beforeAll(() => {
    savedSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    rzp = provider as unknown as typeof rzp;
  });

  afterAll(() => {
    process.env.RAZORPAY_KEY_SECRET = savedSecret;
  });

  it("accepts a genuine Razorpay handler response", () => {
    expect(
      rzp.verifySubscriptionPayment({
        paymentId,
        subscriptionId,
        signature: signPayment(),
      }),
    ).toBe(true);
  });

  it("rejects a forged signature", () => {
    expect(
      rzp.verifySubscriptionPayment({
        paymentId,
        subscriptionId,
        signature: "deadbeef",
      }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      rzp.verifySubscriptionPayment({
        paymentId,
        subscriptionId,
        signature: signPayment("someone_elses_secret"),
      }),
    ).toBe(false);
  });

  it("rejects a valid signature replayed against a different subscription", () => {
    // Signature binds the pair, so swapping the subscription must not verify.
    expect(
      rzp.verifySubscriptionPayment({
        paymentId,
        subscriptionId: "sub_belonging_to_another_org",
        signature: signPayment(),
      }),
    ).toBe(false);
  });

  it("does not use the webhook secret for this scheme", () => {
    const withWebhookSecret = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest("hex");
    expect(
      rzp.verifySubscriptionPayment({
        paymentId,
        subscriptionId,
        signature: withWebhookSecret,
      }),
    ).toBe(false);
  });
});

describe("provider selection", () => {
  it("defaults to Razorpay, and honours an explicit stripe setting", async () => {
    const { activeProviderName } = await import("@/server/services/payments");
    const saved = process.env.PAYMENT_PROVIDER;
    try {
      delete process.env.PAYMENT_PROVIDER;
      // Stripe is invite-only for India-based accounts, so an unset variable
      // must land on the provider that actually works.
      expect(activeProviderName()).toBe("razorpay");

      process.env.PAYMENT_PROVIDER = "stripe";
      expect(activeProviderName()).toBe("stripe");
    } finally {
      process.env.PAYMENT_PROVIDER = saved;
    }
  });

  it("routes an existing org to ITS provider, not the deployment default", async () => {
    const { providerFor } = await import("@/server/services/payments");
    const saved = process.env.PAYMENT_PROVIDER;
    process.env.PAYMENT_PROVIDER = "razorpay";
    try {
      // Cancelling a Stripe org's subscription through Razorpay would look up
      // a Stripe ID in Razorpay, fail, and leave a customer billed for a plan
      // they cancelled.
      expect(providerFor({ paymentProvider: "STRIPE" }).name).toBe("stripe");
      expect(providerFor({ paymentProvider: "RAZORPAY" }).name).toBe("razorpay");
      // Never paid → whatever it would use next.
      expect(providerFor({ paymentProvider: null }).name).toBe("razorpay");
    } finally {
      process.env.PAYMENT_PROVIDER = saved;
    }
  });
});
