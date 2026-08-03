// Phase 3b — Stripe webhook receiver tests.
//
// Covers the three properties the handler documents: authenticity (signature
// verification), idempotency (redelivery is a no-op), and correct retry
// signalling (permanent problems answer 200, transient ones 500).
//
// Signatures are real, not mocked: Stripe's SDK ships
// `webhooks.generateTestHeaderString`, which signs a payload with an arbitrary
// secret offline. That exercises the actual verification code path rather than
// a stub of it, and needs no Stripe account.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import Stripe from "stripe";

// Must be set before the route module is imported — it reads the secret at
// module scope. The route is therefore imported dynamically in beforeAll.
const WEBHOOK_SECRET = "whsec_test_billing_webhook_spec";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

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
const stripe = new Stripe("sk_test_billing_webhook_spec", {
  apiVersion: "2026-06-24.dahlia",
});

let POST: (req: Request) => Promise<Response>;

/** Build a signed request exactly as Stripe would deliver it. */
function signedRequest(event: unknown, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

function subscriptionEvent(opts: {
  eventId: string;
  type: string;
  organizationId: string;
  priceId: string;
  customerId: string;
  subscriptionId: string;
  status?: string;
}) {
  return {
    id: opts.eventId,
    object: "event",
    type: opts.type,
    data: {
      object: {
        id: opts.subscriptionId,
        object: "subscription",
        customer: opts.customerId,
        status: opts.status ?? "active",
        cancel_at: null,
        metadata: { organizationId: opts.organizationId },
        items: { data: [{ price: { id: opts.priceId } }] },
      },
    },
  };
}

let org: { id: string };
let proPlan: { id: string };
let freePlan: { id: string };
const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

beforeAll(async () => {
  ({ POST } = (await import("@/app/api/webhooks/stripe/route")) as unknown as {
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
      name: `pro-webhook-spec-${suffix}`,
      displayName: "Pro (spec)",
      price: 99,
      stripePriceId: `price_spec_${suffix}`,
      limits: { users: 25, frameworks: 15, storageMb: 5000 },
    },
  });

  org = await prisma.organization.create({
    data: { name: `WebhookSpecOrg ${suffix}`, planId: freePlan.id },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.processedWebhookEvent.deleteMany({
    where: { eventId: { contains: suffix } },
  });
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  await prisma.plan.deleteMany({ where: { id: proPlan.id } });
  await prisma.$disconnect();
});

describe("signature verification", () => {
  it("rejects a request with no stripe-signature header", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        body: JSON.stringify({ id: "evt_nosig", type: "ping" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const event = subscriptionEvent({
      eventId: `evt_wrongsecret_${suffix}`,
      type: "customer.subscription.updated",
      organizationId: org.id,
      priceId: `price_spec_${suffix}`,
      customerId: `cus_spec_${suffix}`,
      subscriptionId: `sub_spec_${suffix}`,
    });
    const res = await POST(signedRequest(event, "whsec_the_wrong_secret"));
    expect(res.status).toBe(400);
  });

  it("rejects a payload tampered with after signing", async () => {
    const event = subscriptionEvent({
      eventId: `evt_tampered_${suffix}`,
      type: "customer.subscription.updated",
      organizationId: org.id,
      priceId: `price_spec_${suffix}`,
      customerId: `cus_spec_${suffix}`,
      subscriptionId: `sub_spec_${suffix}`,
    });
    const payload = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    // Same signature, different body — the classic replay-with-edit attack.
    const tampered = payload.replace(`"status":"active"`, `"status":"trialing"`);
    const res = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": header },
        body: tampered,
      }),
    );
    expect(res.status).toBe(400);

    // And nothing was written.
    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(freePlan.id);
  });

  it("does not leak the underlying error text to the caller", async () => {
    const res = await POST(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=deadbeef" },
        body: "{}",
      }),
    );
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Invalid signature");
  });
});

describe("idempotency", () => {
  it("applies a subscription event once and ignores the redelivery", async () => {
    const event = subscriptionEvent({
      eventId: `evt_idem_${suffix}`,
      type: "customer.subscription.updated",
      organizationId: org.id,
      priceId: `price_spec_${suffix}`,
      customerId: `cus_idem_${suffix}`,
      subscriptionId: `sub_idem_${suffix}`,
    });

    const first = await POST(signedRequest(event));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, duplicate: false });

    const afterFirst = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(afterFirst.planId).toBe(proPlan.id);

    const auditsAfterFirst = await prisma.auditLog.count({
      where: { organizationId: org.id, action: "BILLING_PLAN_UPDATED" },
    });
    expect(auditsAfterFirst).toBe(1);

    // Exact same event ID delivered again, as Stripe does on a retry.
    const second = await POST(signedRequest(event));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });

    const auditsAfterSecond = await prisma.auditLog.count({
      where: { organizationId: org.id, action: "BILLING_PLAN_UPDATED" },
    });
    expect(auditsAfterSecond).toBe(1); // no duplicate audit entry
  });

  it("records exactly one ledger row per event ID", async () => {
    const rows = await prisma.processedWebhookEvent.count({
      where: { eventId: `evt_idem_${suffix}` },
    });
    expect(rows).toBe(1);
  });
});

describe("retry signalling", () => {
  it("answers 200 for an event whose organization is unknown, so Stripe stops retrying", async () => {
    const event = subscriptionEvent({
      eventId: `evt_unknownorg_${suffix}`,
      type: "customer.subscription.updated",
      organizationId: "org_that_does_not_exist",
      priceId: `price_spec_${suffix}`,
      customerId: `cus_unknown_${suffix}`,
      subscriptionId: `sub_unknown_${suffix}`,
    });
    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);
  });

  it("answers 200 for a Stripe price with no matching local Plan", async () => {
    const event = subscriptionEvent({
      eventId: `evt_noplan_${suffix}`,
      type: "customer.subscription.updated",
      organizationId: org.id,
      priceId: "price_not_seeded_anywhere",
      customerId: `cus_noplan_${suffix}`,
      subscriptionId: `sub_noplan_${suffix}`,
    });
    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);
  });
});

describe("payment failure starts dunning without downgrading", () => {
  it("flags PAST_DUE, keeps the paid plan, and enqueues a notification", async () => {
    await prisma.organization.update({
      where: { id: org.id },
      data: { planId: proPlan.id, subscriptionStatus: "ACTIVE", dunningStartedAt: null },
    });

    const event = {
      id: `evt_failed_${suffix}`,
      object: "event",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: `in_spec_${suffix}`,
          object: "invoice",
          customer: `cus_dunning_${suffix}`,
          amount_due: 9900,
          metadata: { organizationId: org.id },
        },
      },
    };

    const res = await POST(signedRequest(event));
    expect(res.status).toBe(200);

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.subscriptionStatus).toBe("PAST_DUE");
    expect(after.planId).toBe(proPlan.id); // NOT downgraded on first failure
    expect(after.dunningStartedAt).not.toBeNull();

    expect(enqueueDunningNotification).toHaveBeenCalledWith({
      organizationId: org.id,
      invoiceId: `in_spec_${suffix}`,
    });

    const audits = await prisma.auditLog.count({
      where: { organizationId: org.id, action: "BILLING_PAYMENT_FAILED" },
    });
    expect(audits).toBe(1);
  });
});
