// Phase 3c — Razorpay webhook receiver tests.
//
// Deliberately mirrors tests/billing.webhook.test.ts so the two providers are
// held to the SAME standard: authenticity, idempotency, and correct retry
// signalling. The migration brief called out three bug classes already found
// once in the Stripe path; each has a named test here proving it is absent in
// the new adapter rather than assumed absent:
//   - metadata that never reaches the object the webhook reads
//   - missing idempotency
//   - an unverified organizationId causing a 500 and an infinite retry loop
//
// Signatures are real, not mocked. Razorpay's scheme is a plain HMAC-SHA256 of
// the raw body under the webhook secret, so a correct signature can be
// produced offline with an arbitrary secret — no Razorpay account needed. This
// exercises the actual verification path rather than a stub of it.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

// Must be set before the route module is imported. The route is therefore
// imported dynamically in beforeAll — see the note at the bottom of this file.
const WEBHOOK_SECRET = "rzp_whsec_billing_webhook_spec";
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

// The handler enqueues a dunning notification on payment failure; Redis is not
// available under jest, so the queue module is stubbed. The enqueue call is
// asserted via this mock rather than by draining a real queue.
const enqueueDunningNotification = jest.fn(async () => {});
jest.mock("@/server/queue/dunningQueue", () => ({
  enqueueDunningNotification: (...args: unknown[]) =>
    (enqueueDunningNotification as (...a: unknown[]) => Promise<void>)(...args),
  DUNNING_GRACE_PERIOD_DAYS: 14,
}));

const prisma = new PrismaClient();

let POST: (req: Request) => Promise<Response>;

/** Sign exactly as Razorpay does: HMAC-SHA256 over the raw body. */
function sign(payload: string, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signedRequest(
  event: unknown,
  opts: { secret?: string; eventId?: string } = {},
) {
  const payload = JSON.stringify(event);
  const headers: Record<string, string> = {
    "x-razorpay-signature": sign(payload, opts.secret ?? WEBHOOK_SECRET),
    "content-type": "application/json",
  };
  if (opts.eventId !== undefined) headers["x-razorpay-event-id"] = opts.eventId;

  return new Request("http://localhost/api/webhooks/razorpay", {
    method: "POST",
    headers,
    body: payload,
  });
}

function subscriptionEvent(opts: {
  type: string;
  organizationId?: string | null;
  planId: string;
  customerId?: string | null;
  subscriptionId: string;
  status?: string;
}) {
  return {
    entity: "event",
    event: opts.type,
    contains: ["subscription"],
    payload: {
      subscription: {
        entity: {
          id: opts.subscriptionId,
          entity: "subscription",
          plan_id: opts.planId,
          customer_id: opts.customerId ?? null,
          status: opts.status ?? "active",
          current_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          ended_at: null,
          // `notes` is Razorpay's metadata field, set at subscription creation
          // — which is the object the webhook delivers. See the metadata test.
          notes:
            opts.organizationId === null
              ? {}
              : { organizationId: opts.organizationId },
        },
      },
    },
  };
}

let org: { id: string };
let proPlan: { id: string };
let freePlan: { id: string };
const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const RZP_PLAN = `plan_spec_${suffix}`;

beforeAll(async () => {
  ({ POST } = (await import("@/app/api/webhooks/razorpay/route")) as unknown as {
    POST: (req: Request) => Promise<Response>;
  });

  freePlan = await prisma.plan.upsert({
    where: { name: "free" },
    update: {},
    create: {
      name: "free",
      displayName: "Free",
      price: 0,
      limits: { users: 5, frameworks: 3, storageMb: 100 },
    },
  });

  proPlan = await prisma.plan.create({
    data: {
      name: `pro-rzp-spec-${suffix}`,
      displayName: "Pro (rzp spec)",
      price: 8000,
      currency: "INR",
      razorpayPlanId: RZP_PLAN,
      limits: { users: 25, frameworks: 15, storageMb: 5000 },
    },
  });

  org = await prisma.organization.create({
    data: { name: `RzpWebhookSpecOrg ${suffix}`, planId: freePlan.id },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.processedWebhookEvent.deleteMany({
    where: { eventId: { contains: suffix } },
  });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.plan.deleteMany({ where: { id: proPlan.id } });
  await prisma.$disconnect();
});

/**
 * Audit entries produced by ONE webhook delivery. The lifecycle service stamps
 * the originating eventId into `changes`, which is what makes "exactly once"
 * assertable per event rather than per organization.
 */
async function auditLogsForEvent(eventId: string) {
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: org.id },
  });
  return logs.filter(
    (log) => (log.changes as { eventId?: string } | null)?.eventId === eventId,
  );
}

/** Reset the org between tests that assert on its final state. */
async function resetOrg() {
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      planId: freePlan.id,
      paymentProvider: null,
      razorpayCustomerId: null,
      razorpaySubscriptionId: null,
      subscriptionStatus: "ACTIVE",
      dunningStartedAt: null,
    },
  });
}

describe("signature verification", () => {
  it("rejects a request with no x-razorpay-signature header", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        body: JSON.stringify({ event: "subscription.activated" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const event = subscriptionEvent({
      type: "subscription.activated",
      organizationId: org.id,
      planId: RZP_PLAN,
      subscriptionId: `sub_wrongsecret_${suffix}`,
    });
    const res = await POST(
      signedRequest(event, { secret: "the_wrong_secret", eventId: `evt_ws_${suffix}` }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a payload tampered with after signing, and writes nothing", async () => {
    await resetOrg();

    const event = subscriptionEvent({
      type: "subscription.activated",
      organizationId: org.id,
      planId: RZP_PLAN,
      subscriptionId: `sub_tampered_${suffix}`,
    });
    const payload = JSON.stringify(event);
    const signature = sign(payload);

    // Same signature, different body — the classic replay-with-edit attack.
    const tampered = payload.replace(`"status":"active"`, `"status":"halted"`);
    const res = await POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `evt_tampered_${suffix}`,
        },
        body: tampered,
      }),
    );
    expect(res.status).toBe(400);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(freePlan.id);
  });

  it("does not leak the underlying error text to the caller", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": "deadbeef" },
        body: "{}",
      }),
    );
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Invalid signature");
  });
});

describe("metadata propagation (regression: Stripe bug #1)", () => {
  // The Stripe bug was metadata set on the Checkout Session, which Stripe does
  // not propagate to the Subscription — so every subscription webhook arrived
  // with no org and paying customers were never upgraded. Razorpay's `notes`
  // are set on the Subscription itself at creation, so they arrive on the
  // object the webhook reads. This asserts that end-to-end rather than
  // assuming it.
  it("resolves the organization from subscription notes and applies the plan", async () => {
    await resetOrg();

    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.activated",
          organizationId: org.id,
          planId: RZP_PLAN,
          customerId: `cust_meta_${suffix}`,
          subscriptionId: `sub_meta_${suffix}`,
        }),
        { eventId: `evt_meta_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id);
    expect(after.paymentProvider).toBe("RAZORPAY");
    expect(after.razorpaySubscriptionId).toBe(`sub_meta_${suffix}`);
    expect(after.subscriptionStatus).toBe("ACTIVE");
  });

  it("writes exactly one AuditLog entry recording the provider", async () => {
    const logs = await auditLogsForEvent(`evt_meta_${suffix}`);
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("BILLING_PLAN_UPDATED");
    expect(JSON.stringify(logs[0].changes)).toContain("razorpay");
  });
});

describe("organization resolution (regression: Stripe bug #3)", () => {
  // The original bug: an organizationId taken from provider metadata was passed
  // straight to organization.update, which throws for an unknown ID. The route
  // read that as a transient fault and answered 500, putting the provider into
  // a retry loop that could never succeed.
  it("answers 200, not 500, for an organizationId that does not exist", async () => {
    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.activated",
          organizationId: "org_that_was_deleted_or_never_existed",
          planId: RZP_PLAN,
          subscriptionId: `sub_unknownorg_${suffix}`,
        }),
        { eventId: `evt_unknownorg_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);
  });

  it("falls back to razorpayCustomerId when notes carry no organizationId", async () => {
    await resetOrg();
    const customerId = `cust_fallback_${suffix}`;
    await prisma.organization.update({
      where: { id: org.id },
      data: { razorpayCustomerId: customerId, paymentProvider: "RAZORPAY" },
    });

    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.activated",
          organizationId: null, // dashboard-initiated change: no Dharma notes
          planId: RZP_PLAN,
          customerId,
          subscriptionId: `sub_fallback_${suffix}`,
        }),
        { eventId: `evt_fallback_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id);
  });

  it("falls back to a known subscription ID when notes and customer are both absent", async () => {
    await resetOrg();
    const subscriptionId = `sub_bysubid_${suffix}`;
    await prisma.organization.update({
      where: { id: org.id },
      data: { razorpaySubscriptionId: subscriptionId, paymentProvider: "RAZORPAY" },
    });

    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.charged",
          organizationId: null,
          planId: RZP_PLAN,
          customerId: null,
          subscriptionId,
        }),
        { eventId: `evt_bysubid_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id);
  });

  it("answers 200 for a Razorpay plan with no local Plan row", async () => {
    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.activated",
          organizationId: org.id,
          planId: `plan_never_seeded_${suffix}`,
          subscriptionId: `sub_noplan_${suffix}`,
        }),
        { eventId: `evt_noplan_${suffix}` },
      ),
    );
    // A seeding gap a human must fix — retrying for 24 hours cannot help.
    expect(res.status).toBe(200);
  });
});

describe("idempotency (regression: Stripe bug #2)", () => {
  it("applies an event once and ignores the redelivery", async () => {
    await resetOrg();

    const event = subscriptionEvent({
      type: "subscription.activated",
      organizationId: org.id,
      planId: RZP_PLAN,
      customerId: `cust_idem_${suffix}`,
      subscriptionId: `sub_idem_${suffix}`,
    });
    const eventId = `evt_idem_${suffix}`;

    const first = await POST(signedRequest(event, { eventId }));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ duplicate: false });

    const second = await POST(signedRequest(event, { eventId }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    // Exactly one state change, one ledger row, and one audit entry.
    const ledger = await prisma.processedWebhookEvent.findMany({
      where: { eventId },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].provider).toBe("RAZORPAY");

    // Scoped to THIS event: other tests in this file legitimately write their
    // own BILLING_PLAN_UPDATED rows, so a bare count would prove nothing about
    // deduplication.
    expect(await auditLogsForEvent(eventId)).toHaveLength(1);
  });

  it("namespaces the dedupe key by provider so the two cannot collide", async () => {
    // A shared event ID across providers must NOT suppress the second one.
    // Before the composite unique this was theoretically possible.
    const sharedId = `evt_collision_${suffix}`;

    await prisma.processedWebhookEvent.create({
      data: { provider: "STRIPE", eventId: sharedId, eventType: "spec.stripe" },
    });

    await expect(
      prisma.processedWebhookEvent.create({
        data: {
          provider: "RAZORPAY",
          eventId: sharedId,
          eventType: "spec.razorpay",
        },
      }),
    ).resolves.toBeTruthy();

    // ...while a true duplicate within one provider is still rejected.
    await expect(
      prisma.processedWebhookEvent.create({
        data: { provider: "STRIPE", eventId: sharedId, eventType: "spec.stripe" },
      }),
    ).rejects.toThrow();
  });

  it("dedupes on a body hash when the event-id header is absent", async () => {
    await resetOrg();

    const event = subscriptionEvent({
      type: "subscription.activated",
      organizationId: org.id,
      planId: RZP_PLAN,
      subscriptionId: `sub_nohdr_${suffix}`,
    });

    // No eventId option → no x-razorpay-event-id header.
    const first = await POST(signedRequest(event));
    expect(await first.json()).toMatchObject({ duplicate: false });

    const second = await POST(signedRequest(event));
    expect(await second.json()).toMatchObject({ duplicate: true });
  });
});

describe("lifecycle events", () => {
  it("downgrades to Free on subscription.cancelled", async () => {
    await resetOrg();
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        planId: proPlan.id,
        paymentProvider: "RAZORPAY",
        razorpaySubscriptionId: `sub_cancel_${suffix}`,
      },
    });

    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.cancelled",
          organizationId: org.id,
          planId: RZP_PLAN,
          subscriptionId: `sub_cancel_${suffix}`,
          status: "cancelled",
        }),
        { eventId: `evt_cancel_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(freePlan.id);
    expect(after.subscriptionStatus).toBe("CANCELED");
    expect(after.razorpaySubscriptionId).toBeNull();
  });

  it("starts the dunning clock on payment.failed without downgrading", async () => {
    await resetOrg();
    const subscriptionId = `sub_dunning_${suffix}`;
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        planId: proPlan.id,
        paymentProvider: "RAZORPAY",
        razorpaySubscriptionId: subscriptionId,
      },
    });

    enqueueDunningNotification.mockClear();

    const res = await POST(
      signedRequest(
        {
          entity: "event",
          event: "payment.failed",
          payload: {
            payment: {
              entity: {
                id: `pay_failed_${suffix}`,
                amount: 800000,
                invoice_id: `inv_failed_${suffix}`,
                customer_id: null,
                notes: { organizationId: org.id },
              },
            },
            invoice: {
              entity: {
                id: `inv_failed_${suffix}`,
                amount_due: 800000,
                subscription_id: subscriptionId,
                customer_id: null,
                notes: {},
              },
            },
          },
        },
        { eventId: `evt_failed_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    // Access is NOT cut on the first failure — the grace period owns that call.
    expect(after.planId).toBe(proPlan.id);
    expect(after.subscriptionStatus).toBe("PAST_DUE");
    expect(after.dunningStartedAt).not.toBeNull();
    expect(enqueueDunningNotification).toHaveBeenCalledTimes(1);
  });

  it("does not restart the dunning clock on a second failure", async () => {
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    const firstFailureAt = before.dunningStartedAt;
    expect(firstFailureAt).not.toBeNull();

    await POST(
      signedRequest(
        {
          entity: "event",
          event: "payment.failed",
          payload: {
            payment: {
              entity: {
                id: `pay_failed2_${suffix}`,
                amount: 800000,
                invoice_id: `inv_failed2_${suffix}`,
                notes: { organizationId: org.id },
              },
            },
            invoice: {
              entity: {
                id: `inv_failed2_${suffix}`,
                amount_due: 800000,
                subscription_id: `sub_dunning_${suffix}`,
                notes: {},
              },
            },
          },
        },
        { eventId: `evt_failed2_${suffix}` },
      ),
    );

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    // Restarting the clock per retry would make the grace period unbounded.
    expect(after.dunningStartedAt?.toISOString()).toBe(
      firstFailureAt?.toISOString(),
    );
  });

  it("clears the dunning clock when a charge succeeds", async () => {
    const res = await POST(
      signedRequest(
        subscriptionEvent({
          type: "subscription.charged",
          organizationId: org.id,
          planId: RZP_PLAN,
          subscriptionId: `sub_dunning_${suffix}`,
        }),
        { eventId: `evt_recovered_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.subscriptionStatus).toBe("ACTIVE");
    expect(after.dunningStartedAt).toBeNull();
  });

  it("ignores an unrelated one-off payment failure", async () => {
    await resetOrg();
    await prisma.organization.update({
      where: { id: org.id },
      data: { planId: proPlan.id, paymentProvider: "RAZORPAY" },
    });

    const res = await POST(
      signedRequest(
        {
          entity: "event",
          event: "payment.failed",
          payload: {
            payment: {
              entity: { id: `pay_oneoff_${suffix}`, amount: 100, notes: {} },
            },
          },
        },
        { eventId: `evt_oneoff_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    // A payment with no subscription context is not a billing delinquency.
    expect(after.dunningStartedAt).toBeNull();
    expect(after.subscriptionStatus).not.toBe("PAST_DUE");
  });

  it("answers 200 for an event type it does not handle", async () => {
    const res = await POST(
      signedRequest(
        { entity: "event", event: "payment.authorized", payload: {} },
        { eventId: `evt_unhandled_${suffix}` },
      ),
    );
    expect(res.status).toBe(200);
  });

  it("answers 200 for a signed payload that is not valid JSON", async () => {
    const body = "not json at all";
    const res = await POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": sign(body) },
        body,
      }),
    );
    // Signed but unparseable — retrying cannot make it parse.
    expect(res.status).toBe(200);
  });
});

// TESTING-INFRASTRUCTURE NOTE (carried from the Stripe suite): this repo
// transforms tests with SWC via next/jest, which only hoists jest.mock() above
// imports when `jest` is the GLOBAL. Tests here import jest from
// @jest/globals, so jest.mock() runs in source order — after a static import
// has already loaded the real module. A static import of a mocked module does
// not merely skip the stub, it can let the suite make LIVE API calls. Mocked
// modules must be pulled in with a dynamic `await import()` inside beforeAll,
// which is why the route is imported there.
