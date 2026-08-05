// Billing router. Razorpay is the sole payment provider.
//
// No procedure here talks to the Razorpay SDK directly — everything goes
// through `razorpayProvider`, which normalises statuses, timestamps and minor
// units at the edge so this file only ever handles Dharma's own vocabulary.
//
// createCheckoutSession returns modal parameters, not a redirect URL: Razorpay
// creates the subscription server-side and the browser opens Checkout.js over
// the current page. See CheckoutHandoff.
import { z } from 'zod';
import { createTRPCRouter, publicProcedure, orgProcedure } from '@/server/trpc';
import { TRPCError } from '@trpc/server';
import { EntitlementService } from '@/server/services/entitlement';
import { emitAuditEvent } from '@/server/services/audit/writer';
import {
  ProviderUnreachableError,
  razorpayProvider,
} from '@/server/services/payments';
import { applySubscriptionState } from '@/server/services/billing/lifecycle';
import { logger } from '@/lib/logger';

/** The org fields every billing procedure needs. */
const BILLING_SELECT = {
  id: true,
  name: true,
  planId: true,
  razorpayCustomerId: true,
  razorpaySubscriptionId: true,
  razorpayPreviousSubscriptionId: true,
  subscriptionStatus: true,
  subscriptionEndsAt: true,
  dunningStartedAt: true,
  gstin: true,
} as const;

type BillingOrg = {
  razorpayCustomerId: string | null;
  razorpaySubscriptionId: string | null;
};

/** The Razorpay identifiers recorded against this org. */
function providerIds(org: BillingOrg) {
  return {
    customerId: org.razorpayCustomerId,
    subscriptionId: org.razorpaySubscriptionId,
  };
}

export const billingRouter = createTRPCRouter({
  /**
   * Whether billing is actually usable on this deployment.
   *
   * The UI gates the upgrade controls on `configured` rather than rendering
   * buttons that fail at the payment step — a dead control is the class of bug
   * this codebase has removed before. Razorpay has no hosted billing portal,
   * so the in-app management screen (BillingManage.tsx) is the only path and
   * the UI does not need to choose between them.
   */
  getProviderInfo: publicProcedure.query(() => ({
    configured: razorpayProvider.isConfigured(),
  })),

  // Get all available plans
  getPlans: publicProcedure.query(async ({ ctx }) => {
    const plans = await ctx.prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { price: 'asc' },
    });

    // `isSellable` is computed server-side so the UI never has to know which
    // identifier column matters. A plan with no razorpayPlanId is correctly not
    // offered, rather than offered and then failing at the payment step.
    return plans.map((plan) => ({
      ...plan,
      isSellable: razorpayProvider.planExternalId(plan) !== null,
    }));
  }),

  // Get current org's plan details
  getCurrentPlan: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      include: { plan: true },
    });
    return org.plan || null;
  }),

  /**
   * Local billing state plus, where available, the provider's own view.
   *
   * Falls back to local state rather than failing when the provider is
   * unreachable: a payment API being down must not blank out the billing page
   * of a customer who is perfectly well subscribed.
   */
  getSubscription: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: { ...BILLING_SELECT, plan: true },
    });

    const local = {
      plan: org.plan,
      status: org.subscriptionStatus?.toLowerCase() ?? null,
      currentPeriodEnd: org.subscriptionEndsAt,
      canceledAt: null as Date | null,
      delinquentSince: org.dunningStartedAt,
      /** True when Razorpay could not be reached, so the UI can say so. */
      stale: false,
    };

    const { subscriptionId } = providerIds(org);
    if (!subscriptionId) return local;

    try {
      const subscription = await razorpayProvider.getSubscription(subscriptionId);
      if (!subscription) return local; // gone at the provider; reconciler will heal

      return {
        ...local,
        status: subscription.rawStatus,
        currentPeriodEnd: subscription.currentPeriodEnd ?? org.subscriptionEndsAt,
        canceledAt: subscription.canceledAt,
      };
    } catch (err) {
      logger.warn(
        { err, organizationId: org.id },
        'billing.getSubscription: Razorpay unreachable — serving local state',
      );
      return { ...local, stale: true };
    }
  }),

  /**
   * Live usage for the three metered resources, for the Billing page's usage
   * bars. Computed against current org data rather than a counter column so it
   * cannot drift; EntitlementService is the same source the limit checks use,
   * so what the user sees is exactly what will be enforced.
   *
   * Provider-independent by construction — usage comes from Dharma's own data,
   * never from the payment provider — so this was untouched by the migration.
   */
  getUsage: orgProcedure.query(async ({ ctx }) => {
    const entitlements = new EntitlementService(ctx.prisma);
    const orgId = ctx.session.user.organizationId;

    const [limits, users, frameworks, storageMb] = await Promise.all([
      entitlements.getEntitlements(orgId),
      entitlements.getUsage(orgId, 'users'),
      entitlements.getUsage(orgId, 'frameworks'),
      entitlements.getUsage(orgId, 'storageMb'),
    ]);

    return {
      usage: { users, frameworks, storageMb },
      limits: limits.limits,
    };
  }),

  /** Billing contact details Dharma stores itself, not the provider. */
  getBillingDetails: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: { gstin: true },
    });
    return org;
  }),

  updateBillingDetails: orgProcedure
    .input(
      z.object({
        // Format per the GST rules: 2-digit state code, 10-char PAN, entity
        // digit, 'Z', checksum. Validated rather than free-text so a typo is
        // caught at entry instead of on a tax filing.
        gstin: z
          .string()
          .regex(
            /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
            'Enter a valid 15-character GSTIN',
          )
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
        select: { gstin: true },
      });

      await ctx.prisma.organization.update({
        where: { id: ctx.session.user.organizationId },
        data: { gstin: input.gstin },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: 'BILLING_DETAILS_UPDATED',
        entity: 'Organization',
        entityId: ctx.session.user.organizationId,
        changes: { from: { gstin: before.gstin }, to: { gstin: input.gstin } },
      });

      return { gstin: input.gstin };
    }),

  /**
   * Invoice history, read live from Razorpay rather than mirrored locally —
   * the provider already holds the authoritative record including credit notes
   * and refunds, and a local copy would be one more thing to drift.
   */
  listInvoices: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: BILLING_SELECT,
    });

    const { customerId, subscriptionId } = providerIds(org);

    // An org that has never paid has no provider customer — that is an empty
    // history, not an error.
    if (!customerId && !subscriptionId) return [];

    return razorpayProvider.listInvoices({ customerId, subscriptionId });
  }),

  /**
   * Start a purchase.
   *
   * Returns a CheckoutHandoff (modal parameters), not a URL: Razorpay creates
   * the subscription server-side and the browser opens Checkout.js over the
   * current page. There is no hosted page to navigate to.
   */
  createCheckoutSession: orgProcedure
    .input(
      z.object({
        planId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
        select: BILLING_SELECT,
      });

      const newPlan = await ctx.prisma.plan.findUniqueOrThrow({
        where: { id: input.planId },
      });

      
      if (!razorpayProvider.planExternalId(newPlan)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            newPlan.price === 0
              ? 'Cannot create checkout for the free plan'
              : `The ${newPlan.displayName} plan has no Razorpay plan configured. Contact support.`,
        });
      }

      const handoff = await razorpayProvider.createCheckout({
        organizationId: org.id,
        organizationName: org.name,
        plan: newPlan,
        customerEmail: ctx.session.user.email ?? undefined,
        customerName: ctx.session.user.name ?? undefined,
        existingCustomerId: org.razorpayCustomerId,
      });

      // Record the Razorpay-side subscription immediately: the modal opens
      // against it, so confirmCheckout must be able to prove it is ours.
      // Razorpay's subscription exists from this moment, and recording it now
      // gives the webhook a third way to resolve the org even if `notes` are
      // ever lost — resolution should not hang on one field.
      if (handoff.kind === 'modal') {
        await ctx.prisma.organization.update({
          where: { id: org.id },
          data: {
            razorpaySubscriptionId: handoff.subscriptionId,
            // If a subscription was already live, this new one supersedes it.
            // Recorded so confirmCheckout can cancel the old mandate without
            // trusting the browser to name it — and so an abandoned checkout
            // leaves a trail rather than an orphaned Razorpay subscription.
            ...(org.razorpaySubscriptionId &&
            org.razorpaySubscriptionId !== handoff.subscriptionId
              ? { razorpayPreviousSubscriptionId: org.razorpaySubscriptionId }
              : {}),
          },
        });
      }

      // Audited at initiation, not just on completion: a checkout that is
      // started and abandoned is still a fact an auditor may need to see, and
      // it is the only record tying a human user to the resulting provider
      // object (webhook-driven events have no authenticated actor).
      await emitAuditEvent(ctx.prisma, {
        organizationId: org.id,
        userId: ctx.session.user.id,
        action: 'BILLING_CHECKOUT_STARTED',
        entity: 'Organization',
        entityId: org.id,
        changes: {
          fromPlanId: org.planId,
          targetPlanId: newPlan.id,
          targetPlanName: newPlan.name,
          providerReference: handoff.reference,
        },
      });

      return handoff;
    }),

  /**
   * Fast-path reconciliation after Razorpay's Checkout.js modal succeeds.
   *
   * THE WEBHOOK REMAINS THE SOURCE OF TRUTH. This procedure exists only so the
   * UI can reflect a successful purchase in a second instead of whenever the
   * webhook lands, and it is safe for the same reason the webhook is: nothing
   * the browser sends is believed. The client's handler response is first
   * checked against Razorpay's own HMAC (payment_id|subscription_id under the
   * key secret), and then the subscription is RE-FETCHED FROM RAZORPAY and the
   * plan applied from that server-side read. A forged callback fails the HMAC;
   * a callback that passes it still cannot name its own plan.
   *
   * It routes through the same applySubscriptionState the webhook uses, so if
   * the webhook arrives first, or arrives later, the ledger makes exactly one
   * of them apply.
   */
  confirmCheckout: orgProcedure
    .input(
      z.object({
        razorpayPaymentId: z.string().min(1),
        razorpaySubscriptionId: z.string().min(1),
        razorpaySignature: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
        select: BILLING_SELECT,
      });

      // Tenant isolation: the subscription must be the one WE created for THIS
      // org at checkout. Without this check a valid signature from any other
      // Razorpay subscription could be replayed against someone else's org.
      if (org.razorpaySubscriptionId !== input.razorpaySubscriptionId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This subscription does not belong to your organization.',
        });
      }


      if (!razorpayProvider.isConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Razorpay is not configured on this server.',
        });
      }

      const signatureValid = razorpayProvider.verifySubscriptionPayment({
        paymentId: input.razorpayPaymentId,
        subscriptionId: input.razorpaySubscriptionId,
        signature: input.razorpaySignature,
      });

      if (!signatureValid) {
        logger.error(
          { organizationId: org.id, subscriptionId: input.razorpaySubscriptionId },
          'billing.confirmCheckout: payment signature verification failed',
        );
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Payment could not be verified.',
        });
      }


      let subscription;
      try {
        subscription = await razorpayProvider.getSubscription(input.razorpaySubscriptionId);
      } catch (err) {
        if (err instanceof ProviderUnreachableError) {
          // Not an error the user caused or can fix, and not a failure of the
          // purchase — the webhook will still apply it. Say so honestly.
          return { applied: false, pending: true as const };
        }
        throw err;
      }

      if (!subscription) return { applied: false, pending: true as const };

      const plan = subscription.planExternalId
        ? await ctx.prisma.plan.findFirst({
            where: razorpayProvider.planWhereExternalId(subscription.planExternalId),
          })
        : null;

      if (!plan) {
        logger.error(
          { razorpayPlanId: subscription.planExternalId, organizationId: org.id },
          'billing.confirmCheckout: no local Plan matches the purchased Razorpay plan',
        );
        return { applied: false, pending: true as const };
      }

      const outcome = await applySubscriptionState({
        // A distinct event key from any webhook delivery, so this fast path and
        // the webhook cannot suppress each other in the dedupe ledger — the
        // ledger's job is to stop DUPLICATE deliveries, not to stop the second
        // source from confirming the same end state.
        ref: {
          eventId: `confirm:${input.razorpayPaymentId}`,
          eventType: 'billing.confirmCheckout',
        },
        organizationId: org.id,
        planId: plan.id,
        planName: plan.name,
        status: subscription.status,
        rawStatus: subscription.rawStatus,
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        endsAt: subscription.endsAt,
      });

      // A payment-method update leaves the previous subscription live with the
      // old mandate still attached to it. Cancel it now that the replacement is
      // confirmed active — in that order, so a failure here leaves the customer
      // over-covered (two mandates, one of which we will retry cancelling)
      // rather than under-covered (no working subscription at all).
      if (
        outcome.applied &&
        org.razorpayPreviousSubscriptionId &&
        org.razorpayPreviousSubscriptionId !== subscription.id
      ) {
        try {
          await razorpayProvider.cancelSubscription(org.razorpayPreviousSubscriptionId);
          await ctx.prisma.organization.update({
            where: { id: org.id },
            data: { razorpayPreviousSubscriptionId: null },
          });
          await emitAuditEvent(ctx.prisma, {
            organizationId: org.id,
            userId: ctx.session.user.id,
            action: 'BILLING_PAYMENT_METHOD_UPDATED',
            entity: 'Organization',
            entityId: org.id,
            changes: {
              supersededSubscriptionId: org.razorpayPreviousSubscriptionId,
              subscriptionId: subscription.id,
              source: 'user',
            },
          });
        } catch (err) {
          // Left un-nulled deliberately: the next confirm, or an operator, can
          // retry. Loud because a live duplicate mandate can bill a customer
          // twice and must not be discovered from a bank statement.
          logger.error(
            {
              err,
              organizationId: org.id,
              supersededSubscriptionId: org.razorpayPreviousSubscriptionId,
            },
            'billing.confirmCheckout: could not cancel the superseded subscription — DUPLICATE MANDATE MAY BE ACTIVE',
          );
        }
      }

      return {
        applied: outcome.applied,
        pending: false as const,
        planName: plan.displayName,
      };
    }),

  /**
   * Begin a payment-method change.
   *
   * Razorpay has no "update card" call — the mandate is bound to the
   * subscription, so the only supported path is authorising a new subscription
   * on the SAME plan and cancelling the old one once the new mandate is live.
   * That cancellation happens in confirmCheckout, server-side.
   *
   * Deliberately reuses createCheckoutSession's machinery rather than a
   * parallel path, so the supersede bookkeeping cannot diverge between the two.
   */
  startPaymentMethodUpdate: orgProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: { ...BILLING_SELECT, plan: true },
    });

    if (!org.plan || !org.razorpaySubscriptionId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active subscription to update a payment method for.',
      });
    }

    const externalId = razorpayProvider.planExternalId(org.plan);
    if (!externalId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Your current plan has no Razorpay plan configured.',
      });
    }

    const handoff = await razorpayProvider.createCheckout({
      organizationId: org.id,
      organizationName: org.name,
      plan: org.plan,
      customerEmail: ctx.session.user.email ?? undefined,
      customerName: ctx.session.user.name ?? undefined,
      existingCustomerId: org.razorpayCustomerId,
    });

    if (handoff.kind !== 'modal') {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected checkout style for a payment-method update.',
      });
    }

    await ctx.prisma.organization.update({
      where: { id: org.id },
      data: {
        razorpaySubscriptionId: handoff.subscriptionId,
        razorpayPreviousSubscriptionId: org.razorpaySubscriptionId,
      },
    });

    await emitAuditEvent(ctx.prisma, {
      organizationId: org.id,
      userId: ctx.session.user.id,
      action: 'BILLING_PAYMENT_METHOD_UPDATE_STARTED',
      entity: 'Organization',
      entityId: org.id,
      changes: {
        supersedingSubscriptionId: handoff.subscriptionId,
        supersededSubscriptionId: org.razorpaySubscriptionId,
      },
    });

    return handoff;
  }),

  // Update subscription to a new plan (for orgs with an existing subscription)
  updateSubscription: orgProcedure
    .input(z.object({ newPlanId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
        select: BILLING_SELECT,
      });

      const { subscriptionId } = providerIds(org);

      if (!subscriptionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Organization does not have an active subscription',
        });
      }

      const newPlan = await ctx.prisma.plan.findUniqueOrThrow({
        where: { id: input.newPlanId },
      });

      const externalId = razorpayProvider.planExternalId(newPlan);
      if (!externalId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            newPlan.price === 0
              ? 'Cannot update to the free plan. Please cancel your subscription instead.'
              : `The ${newPlan.displayName} plan has no Razorpay plan configured.`,
        });
      }

      const updated = await razorpayProvider.updateSubscription(subscriptionId, externalId);

      // Applied locally at once so the UI is not stale for the round-trip; the
      // provider's webhook is still authoritative and will confirm or correct.
      await ctx.prisma.organization.update({
        where: { id: org.id },
        data: { planId: input.newPlanId },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: org.id,
        userId: ctx.session.user.id,
        action: 'BILLING_PLAN_UPDATED',
        entity: 'Organization',
        entityId: org.id,
        changes: {
          from: { planId: org.planId },
          to: { planId: newPlan.id, planName: newPlan.name },
          source: 'user',
        },
      });

      return { subscriptionId: updated.id, status: updated.rawStatus };
    }),

  // Cancel subscription
  cancelSubscription: orgProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: BILLING_SELECT,
    });

    const { subscriptionId } = providerIds(org);

    if (!subscriptionId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active subscription to cancel',
      });
    }

    const canceled = await razorpayProvider.cancelSubscription(subscriptionId);

    const freePlan = await ctx.prisma.plan.findFirstOrThrow({
      where: { name: 'free' },
    });

    await ctx.prisma.organization.update({
      where: { id: org.id },
      data: {
        planId: freePlan.id,
        razorpaySubscriptionId: null,
        subscriptionStatus: 'CANCELED',
        dunningStartedAt: null,
      },
    });

    await emitAuditEvent(ctx.prisma, {
      organizationId: org.id,
      userId: ctx.session.user.id,
      action: 'BILLING_SUBSCRIPTION_CANCELED',
      entity: 'Organization',
      entityId: org.id,
      changes: {
        from: { planId: org.planId },
        to: { planId: freePlan.id, planName: 'free' },
        subscriptionId,
        source: 'user',
      },
    });

    return { subscriptionId: canceled.id, status: canceled.rawStatus };
  }),
});

/** Exported for tests and diagnostics. */
