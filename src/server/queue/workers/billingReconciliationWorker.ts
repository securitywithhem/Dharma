// Phase 3b/3c — billing reconciliation worker.
//
// Daily drift correction between local billing state and the payment provider.
// The provider is the source of truth for what a customer is actually paying
// for; this worker only ever moves local state toward it, never the reverse.
//
// Phase 3c made it provider-aware. It reconciles EVERY org that has a
// subscription with either provider, resolving the adapter per org rather than
// per deployment — an org still on Stripe must keep being reconciled against
// Stripe after the default switched to Razorpay, or its drift goes uncorrected
// forever. The correction logic itself is provider-independent and unchanged.
//
// Every correction is logged AND audited: a plan silently changing underneath
// a customer is exactly the kind of event this product exists to make
// explainable, and a run of corrections is also the signal that the webhook
// endpoint itself is broken.
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { providerFor } from "@/server/services/payments";
import {
  BILLING_RECONCILIATION_QUEUE_NAME,
  type BillingReconciliationJobData,
} from "@/server/queue/billingReconciliationQueue";
import { logger } from "@/lib/logger";

/** Processed-event rows older than this are pruned; Stripe never retries that long. */
export const WEBHOOK_LEDGER_RETENTION_DAYS = 30;

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

// Status mapping lives in each provider's adapter and is shared with the
// webhook receiver — the two must never disagree about what a status means.

export function createBillingReconciliationProcessor(prisma: PrismaClient) {
  return async (_job: Job<BillingReconciliationJobData>) => {
    const orgs = await prisma.organization.findMany({
      where: {
        OR: [
          { stripeSubscriptionId: { not: null } },
          { razorpaySubscriptionId: { not: null } },
        ],
      },
      select: {
        id: true,
        planId: true,
        paymentProvider: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        razorpayCustomerId: true,
        razorpaySubscriptionId: true,
        subscriptionStatus: true,
      },
    });

    const freePlan = await prisma.plan.findFirst({ where: { name: "free" } });
    let corrected = 0;

    for (const org of orgs) {
      const provider = providerFor(org);
      const subscriptionId =
        provider.name === "stripe"
          ? org.stripeSubscriptionId
          : org.razorpaySubscriptionId;

      if (!subscriptionId) continue;

      let subscription;
      try {
        // The adapter contract: null means the provider CONFIRMED the
        // subscription is gone; a throw means we could not find out. Only the
        // first is safe to act on.
        subscription = await provider.getSubscription(subscriptionId);
      } catch (err) {
        logger.error(
          { err, organizationId: org.id, provider: provider.name },
          "reconciliation: could not retrieve subscription — leaving local state untouched",
        );
        continue;
      }

      if (!subscription) {
        // The subscription no longer exists at the provider and we never got
        // the cancellation event — this is precisely the drift we exist to
        // catch.
        if (!freePlan) {
          logger.error(
            { organizationId: org.id },
            "reconciliation: subscription gone at provider but no free Plan to fall back to",
          );
          continue;
        }
        await prisma.organization.update({
          where: { id: org.id },
          data: {
            planId: freePlan.id,
            // Clear only the provider's own column — the other provider's
            // historical link is not drift and must survive.
            ...(provider.name === "stripe"
              ? { stripeSubscriptionId: null }
              : { razorpaySubscriptionId: null }),
            subscriptionStatus: "CANCELED",
            dunningStartedAt: null,
          },
        });
        await emitAuditEvent(prisma, {
          organizationId: org.id,
          userId: null,
          action: "BILLING_RECONCILED",
          entity: "Organization",
          entityId: org.id,
          changes: {
            provider: provider.name,
            reason: "subscription missing at provider",
            from: { planId: org.planId },
            to: { planId: freePlan.id, planName: "free" },
          },
        });
        corrected += 1;
        continue;
      }

      const plan = subscription.planExternalId
        ? await prisma.plan.findFirst({
            where: provider.planWhereExternalId(subscription.planExternalId),
          })
        : null;
      const status = subscription.status;

      const planDrifted = plan != null && plan.id !== org.planId;
      const statusDrifted = status !== org.subscriptionStatus;
      if (!planDrifted && !statusDrifted) continue;

      await prisma.organization.update({
        where: { id: org.id },
        data: {
          ...(planDrifted && plan ? { planId: plan.id } : {}),
          subscriptionStatus: status,
        },
      });

      await emitAuditEvent(prisma, {
        organizationId: org.id,
        userId: null,
        action: "BILLING_RECONCILED",
        entity: "Organization",
        entityId: org.id,
        changes: {
          provider: provider.name,
          reason: "local state drifted from the payment provider",
          from: { planId: org.planId, subscriptionStatus: org.subscriptionStatus },
          to: {
            planId: planDrifted && plan ? plan.id : org.planId,
            subscriptionStatus: status,
          },
        },
      });

      logger.warn(
        { organizationId: org.id, provider: provider.name, planDrifted, statusDrifted },
        "reconciliation: corrected billing drift — check webhook delivery health",
      );
      corrected += 1;
    }

    // Prune the webhook idempotency ledger in the same pass.
    const cutoff = new Date(
      Date.now() - WEBHOOK_LEDGER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const pruned = await prisma.processedWebhookEvent.deleteMany({
      where: { processedAt: { lt: cutoff } },
    });

    return { examined: orgs.length, corrected, prunedEvents: pruned.count };
  };
}

export function startBillingReconciliationWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<BillingReconciliationJobData>(
    BILLING_RECONCILIATION_QUEUE_NAME,
    createBillingReconciliationProcessor(prisma),
    { connection: redisConnection(), concurrency: 1 },
  );

  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "billing reconciliation failed");
  });

  return worker;
}
