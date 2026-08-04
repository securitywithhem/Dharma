// Phase 3b/3c — dunning worker.
//
// Handles two job kinds (see dunningQueue.ts):
//   notify — email the org's owners that a payment failed.
//   sweep  — daily: downgrade orgs still delinquent past the grace period.
//
// The downgrade decision is deliberately re-checked against the payment
// provider rather than trusted from local state: between the failure and the
// sweep the customer may have paid, and a webhook for that could have been
// missed. Downgrading a paying customer is far worse than a day's delay.
//
// Phase 3c made only the status re-check provider-aware. The GRACE-PERIOD
// POLICY IS UNCHANGED and provider-independent by design: 14 days, clocked from
// the FIRST failure only (restarting per retry would make it unbounded),
// re-checked before acting, and skipped rather than guessed when the provider
// cannot be reached.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { sendMail } from "@/server/lib/mailer";
import { providerFor } from "@/server/services/payments";
import {
  DUNNING_QUEUE_NAME,
  DUNNING_GRACE_PERIOD_DAYS,
  type DunningJobData,
} from "@/server/queue/dunningQueue";
import { logger } from "@/lib/logger";

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

/** Pure predicate, exported for unit testing. */
export function isGracePeriodElapsed(
  dunningStartedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!dunningStartedAt) return false;
  const elapsedMs = now.getTime() - dunningStartedAt.getTime();
  return elapsedMs >= DUNNING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Who to chase for a failed payment. This schema's Role enum has no OWNER —
 * ADMIN is the highest privilege level (see packages/db/schema.prisma), and
 * `billing.manage` is an ADMIN permission, so admins are the billing contacts.
 */
async function billingContactsFor(prisma: PrismaClient, organizationId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, role: "ADMIN" },
    select: { email: true },
  });
  return users.map((u) => u.email).filter((e): e is string => Boolean(e));
}

async function handleNotify(
  prisma: PrismaClient,
  data: Extract<DunningJobData, { kind: "notify" }>,
) {
  const org = await prisma.organization.findUnique({
    where: { id: data.organizationId },
    select: { id: true, name: true, dunningStartedAt: true },
  });
  if (!org) return { notified: 0 };

  const to = await billingContactsFor(prisma, org.id);
  if (to.length === 0) {
    logger.warn(
      { organizationId: org.id },
      "dunning: no admin with an email to notify",
    );
    return { notified: 0 };
  }

  const deadline = org.dunningStartedAt
    ? new Date(
        org.dunningStartedAt.getTime() +
          DUNNING_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
      )
    : null;

  await sendMail({
    to,
    subject: `Payment failed for ${org.name}`,
    text: [
      `We could not process the most recent payment for ${org.name}.`,
      ``,
      `Your data and settings are unchanged. To keep your current plan, please`,
      `update your payment method in Settings → Billing → Manage billing.`,
      deadline
        ? `\nIf payment is not received by ${deadline.toDateString()}, the` +
          ` organization will move to the Free plan.`
        : ``,
    ].join("\n"),
  });

  return { notified: to.length };
}

async function handleSweep(prisma: PrismaClient, now: Date) {
  const delinquent = await prisma.organization.findMany({
    where: { dunningStartedAt: { not: null }, subscriptionStatus: "PAST_DUE" },
    select: {
      id: true,
      dunningStartedAt: true,
      planId: true,
      paymentProvider: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      razorpayCustomerId: true,
      razorpaySubscriptionId: true,
    },
  });

  const freePlan = await prisma.plan.findFirst({ where: { name: "free" } });
  if (!freePlan) {
    throw new Error('No "free" Plan row exists to downgrade delinquent orgs into');
  }

  let downgraded = 0;

  for (const org of delinquent) {
    if (!isGracePeriodElapsed(org.dunningStartedAt, now)) continue;

    const provider = providerFor(org);
    const subscriptionId =
      provider.name === "stripe"
        ? org.stripeSubscriptionId
        : org.razorpaySubscriptionId;

    // Re-check with the provider before acting. If the subscription is healthy
    // again, the org paid and we missed the event — heal local state instead of
    // cutting them off.
    if (subscriptionId) {
      try {
        const sub = await provider.getSubscription(subscriptionId);
        // ACTIVE covers Stripe's active/trialing and Razorpay's active; the
        // adapters already normalised them, so this stays one comparison
        // rather than a per-provider status list that could drift.
        if (sub?.status === "ACTIVE") {
          await prisma.organization.update({
            where: { id: org.id },
            data: { subscriptionStatus: "ACTIVE", dunningStartedAt: null },
          });
          logger.info(
            { organizationId: org.id, provider: provider.name },
            "dunning: subscription healthy at provider — cleared delinquency instead of downgrading",
          );
          continue;
        }
      } catch (err) {
        // Cannot confirm with the provider → do not downgrade on a guess. Try
        // again tomorrow; the org keeps access one more day, which is the safe
        // error. (A CONFIRMED-gone subscription returns null, not a throw, and
        // correctly falls through to the downgrade below.)
        logger.error(
          { err, organizationId: org.id, provider: provider.name },
          "dunning: could not verify subscription at provider — skipping downgrade this run",
        );
        continue;
      }
    }

    await prisma.organization.update({
      where: { id: org.id },
      data: {
        planId: freePlan.id,
        subscriptionStatus: "CANCELED",
        // Clear only the delinquent provider's own subscription link.
        ...(provider.name === "stripe"
          ? { stripeSubscriptionId: null }
          : { razorpaySubscriptionId: null }),
        dunningStartedAt: null,
      },
    });

    await emitAuditEvent(prisma, {
      organizationId: org.id,
      userId: null,
      action: "BILLING_DOWNGRADED_FOR_NONPAYMENT",
      entity: "Organization",
      entityId: org.id,
      changes: {
        provider: provider.name,
        from: { planId: org.planId },
        to: { planId: freePlan.id, planName: "free" },
        dunningStartedAt: org.dunningStartedAt?.toISOString() ?? null,
        gracePeriodDays: DUNNING_GRACE_PERIOD_DAYS,
      },
    });

    downgraded += 1;
  }

  return { examined: delinquent.length, downgraded };
}

export function createDunningProcessor(prisma: PrismaClient) {
  return async (job: Job<DunningJobData>) => {
    if (job.data.kind === "notify") {
      return handleNotify(prisma, job.data);
    }
    return handleSweep(prisma, new Date());
  };
}

export function startDunningWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<DunningJobData>(
    DUNNING_QUEUE_NAME,
    createDunningProcessor(prisma),
    { connection: redisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "dunning job failed");
  });

  return worker;
}
