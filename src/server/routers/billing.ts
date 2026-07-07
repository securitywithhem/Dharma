import { z } from 'zod';
import Stripe from 'stripe';
import { createTRPCRouter, publicProcedure, orgProcedure } from '@/server/trpc';
import stripe, {
  createCheckoutSession,
  updateSubscription,
  cancelSubscription,
} from '@/lib/stripe';
import { TRPCError } from '@trpc/server';

export const billingRouter = createTRPCRouter({
  // Get all available plans
  getPlans: publicProcedure.query(async ({ ctx }) => {
    const plans = await ctx.prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { price: 'asc' },
    });
    return plans;
  }),

  // Get current org's plan details
  getCurrentPlan: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      include: { plan: true },
    });
    return org.plan || null;
  }),

  // Get organization's subscription info
  getSubscription: orgProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
      select: {
        plan: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    if (org.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(
        org.stripeSubscriptionId
      );
      
      const subAny = subscription as any;
      return {
        plan: org.plan,
        status: subscription.status,
        currentPeriodEnd: new Date(subAny.current_period_end * 1000),
        canceledAt: subAny.canceled_at
          ? new Date(subAny.canceled_at * 1000)
          : null,
      };
    }

    return {
      plan: org.plan,
      status: org.subscriptionStatus?.toLowerCase() || null,
      currentPeriodEnd: org.subscriptionEndsAt,
      canceledAt: null,
    };
  }),

  // Create checkout session for a plan upgrade
  createCheckoutSession: orgProcedure
    .input(
      z.object({
        planId: z.string(),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
        include: { plan: true },
      });

      const newPlan = await ctx.prisma.plan.findUniqueOrThrow({
        where: { id: input.planId },
      });

      if (!newPlan.stripePriceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot create checkout for free plan',
        });
      }

      const session = await createCheckoutSession(
        ctx.session.user.organizationId,
        newPlan.stripePriceId,
        input.successUrl,
        input.cancelUrl,
        ctx.session.user.email ?? undefined
      );

      return { sessionId: session.id, url: session.url };
    }),

  // Update subscription to a new plan (for existing Stripe customers)
  updateSubscription: orgProcedure
    .input(
      z.object({
        newPlanId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.session.user.organizationId },
      });

      if (!org.stripeSubscriptionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Organization does not have an active subscription',
        });
      }

      const newPlan = await ctx.prisma.plan.findUniqueOrThrow({
        where: { id: input.newPlanId },
      });

      if (!newPlan.stripePriceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot update to free plan. Please cancel subscription instead.',
        });
      }

      const updatedSub = await updateSubscription(
        org.stripeSubscriptionId,
        newPlan.stripePriceId
      );

      // Update org plan immediately
      await ctx.prisma.organization.update({
        where: { id: ctx.session.user.organizationId },
        data: { planId: input.newPlanId },
      });

      return {
        subscriptionId: updatedSub.id,
        status: updatedSub.status,
      };
    }),

  // Cancel subscription
  cancelSubscription: orgProcedure.mutation(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUniqueOrThrow({
      where: { id: ctx.session.user.organizationId },
    });

    if (!org.stripeSubscriptionId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active subscription to cancel',
      });
    }

    const canceledSub = await cancelSubscription(org.stripeSubscriptionId);

    // Set org to free plan
    const freePlan = await ctx.prisma.plan.findFirstOrThrow({
      where: { name: 'free' },
    });

    await ctx.prisma.organization.update({
      where: { id: ctx.session.user.organizationId },
      data: {
        planId: freePlan.id,
        stripeSubscriptionId: null,
        subscriptionStatus: 'CANCELED',
      },
    });

    return { subscriptionId: canceledSub.id, status: canceledSub.status };
  }),
});
