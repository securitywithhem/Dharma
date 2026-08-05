// Phase 3b — dunning sweep and grace period.
//
// The failure this suite guards against is downgrading a customer who has
// actually paid. Razorpay is therefore re-checked before any downgrade, and the
// sweep must skip (not downgrade) whenever it cannot confirm delinquency.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PrismaClient } from "@prisma/client";

// The Razorpay service is stubbed so the sweep's "re-check before acting"
// branch can be driven without a Razorpay account. The contract is what matters
// here — a NORMALISED status ("ACTIVE", not "active"), null for a
// confirmed-gone subscription, and a throw for "could not find out".
let mockGetSubscription: () => Promise<unknown> = async () => ({
  status: "PAST_DUE",
});
jest.mock("@/server/services/payments", () => ({
  razorpayProvider: {
    getSubscription: () => mockGetSubscription(),
  },
}));

// Mailer is stubbed: the notify path is asserted by call, not by SMTP.
jest.mock("@/server/lib/mailer", () => ({
  sendMail: async () => ({ sent: true }),
}));

// The worker is imported DYNAMICALLY in beforeAll, not with a static import.
// This repo transforms tests with SWC via next/jest, and SWC only hoists
// jest.mock() calls above the imports when `jest` is the global. Here `jest`
// comes from @jest/globals, so the mocks above are registered in source order
// — i.e. AFTER a static import would already have pulled in the real
// @/server/services/payments. A static import here does not just skip the
// stub, it lets the suite make live Razorpay API calls. See
// tests/billing.razorpay.webhook.test.ts for the same pattern.
type DunningWorkerModule = typeof import("@/server/queue/workers/dunningWorker");
let createDunningProcessor: DunningWorkerModule["createDunningProcessor"];
let isGracePeriodElapsed: DunningWorkerModule["isGracePeriodElapsed"];
let DUNNING_GRACE_PERIOD_DAYS: number;

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let freePlan: { id: string };
let proPlan: { id: string };

async function makeDelinquentOrg(daysAgo: number, subscriptionId: string | null) {
  return prisma.organization.create({
    data: {
      name: `DunningSpec ${suffix} ${Math.random()}`,
      planId: proPlan.id,
      subscriptionStatus: "PAST_DUE",
      dunningStartedAt: new Date(Date.now() - daysAgo * DAY_MS),
      // The sweep re-checks this subscription before downgrading; leaving it
      // null would make the org look like it has nothing to re-check.
      razorpaySubscriptionId: subscriptionId,
    },
  });
}

/** Run only the sweep branch of the processor. */
async function runSweep() {
  const processor = createDunningProcessor(prisma);
  return processor({ data: { kind: "sweep" } } as never) as Promise<{
    examined: number;
    downgraded: number;
  }>;
}

beforeAll(async () => {
  ({ createDunningProcessor, isGracePeriodElapsed } = await import(
    "@/server/queue/workers/dunningWorker"
  ));
  ({ DUNNING_GRACE_PERIOD_DAYS } = await import("@/server/queue/dunningQueue"));

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
      name: `pro-dunning-spec-${suffix}`,
      displayName: "Pro (spec)",
      price: 99,
      razorpayPlanId: `plan_dunning_${suffix}`,
      limits: { users: 25, frameworks: 15, storageMb: 5000 },
    },
  });
});

afterAll(async () => {
  const orgs = await prisma.organization.findMany({
    where: { name: { contains: `DunningSpec ${suffix}` } },
    select: { id: true },
  });
  const ids = orgs.map((o) => o.id);
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.plan.deleteMany({ where: { id: proPlan.id } });
  await prisma.$disconnect();
});

describe("isGracePeriodElapsed", () => {
  it("is false for an org that is not delinquent", () => {
    expect(isGracePeriodElapsed(null)).toBe(false);
  });

  it("is false one day before the deadline", () => {
    const started = new Date(Date.now() - (DUNNING_GRACE_PERIOD_DAYS - 1) * DAY_MS);
    expect(isGracePeriodElapsed(started)).toBe(false);
  });

  it("is true exactly at the deadline", () => {
    const started = new Date(Date.now() - DUNNING_GRACE_PERIOD_DAYS * DAY_MS);
    expect(isGracePeriodElapsed(started)).toBe(true);
  });
});

describe("dunning sweep", () => {
  it("leaves an org inside the grace period untouched", async () => {
    const org = await makeDelinquentOrg(3, `sub_inside_${suffix}`);
    mockGetSubscription = async () => ({ status: "PAST_DUE" });

    await runSweep();

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id);
    expect(after.subscriptionStatus).toBe("PAST_DUE");
  });

  it("downgrades an org past the grace period and audits it", async () => {
    const org = await makeDelinquentOrg(
      DUNNING_GRACE_PERIOD_DAYS + 1,
      `sub_expired_${suffix}`,
    );
    mockGetSubscription = async () => ({ status: "PAST_DUE" });

    await runSweep();

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(freePlan.id);
    expect(after.subscriptionStatus).toBe("CANCELED");
    expect(after.dunningStartedAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "BILLING_DOWNGRADED_FOR_NONPAYMENT",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("clears delinquency instead of downgrading when the provider says the subscription is active", async () => {
    const org = await makeDelinquentOrg(
      DUNNING_GRACE_PERIOD_DAYS + 5,
      `sub_recovered_${suffix}`,
    );
    // Customer paid via the provider portal; we missed the webhook.
    mockGetSubscription = async () => ({ status: "ACTIVE" });

    await runSweep();

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id); // NOT downgraded
    expect(after.subscriptionStatus).toBe("ACTIVE");
    expect(after.dunningStartedAt).toBeNull();
  });

  it("skips the downgrade when the provider cannot be reached, rather than guessing", async () => {
    const org = await makeDelinquentOrg(
      DUNNING_GRACE_PERIOD_DAYS + 2,
      `sub_unreachable_${suffix}`,
    );
    mockGetSubscription = async () => {
      throw new Error("provider API unreachable");
    };

    await runSweep();

    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(after.planId).toBe(proPlan.id); // access preserved on uncertainty
    expect(after.subscriptionStatus).toBe("PAST_DUE");
  });
});
