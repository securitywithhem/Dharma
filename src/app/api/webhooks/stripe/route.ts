import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/server/db';
import stripe from '@/lib/stripe';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: `Webhook Error: ${err instanceof Error ? err.message : 'Unknown'}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organizationId as string;

        if (!organizationId) {
          console.warn('No organizationId in subscription metadata');
          return NextResponse.json({ error: 'No organizationId' }, { status: 400 });
        }

        const priceId = subscription.items.data[0]?.price.id;
        const plan = await prisma.plan.findFirst({
          where: { stripePriceId: priceId },
        });

        if (!plan) {
          console.warn(`No plan found for priceId: ${priceId}`);
          return NextResponse.json({ error: 'No plan found' }, { status: 400 });
        }

        // Update organization with subscription details
        await prisma.organization.update({
          where: { id: organizationId },
          data: {
            stripeCustomerId: subscription.customer as string,
            stripeSubscriptionId: subscription.id,
            planId: plan.id,
            subscriptionStatus: subscription.status as any,
            subscriptionEndsAt: subscription.cancel_at
              ? new Date(subscription.cancel_at * 1000)
              : null,
          },
        });

        console.log(`Subscription ${subscription.id} processed for org ${organizationId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organizationId as string;

        if (!organizationId) {
          return NextResponse.json({ error: 'No organizationId' }, { status: 400 });
        }

        const freePlan = await prisma.plan.findFirstOrThrow({
          where: { name: 'free' },
        });

        await prisma.organization.update({
          where: { id: organizationId },
          data: {
            stripeSubscriptionId: null,
            planId: freePlan.id,
            subscriptionStatus: 'CANCELED',
          },
        });

        console.log(`Subscription ${subscription.id} deleted for org ${organizationId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.warn(`Payment failed for invoice ${invoice.id}, customer ${invoice.customer}`);
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return NextResponse.json(
      { error: `Server error: ${err instanceof Error ? err.message : 'Unknown'}` },
      { status: 500 }
    );
  }
}
