import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/server/db';
import stripe from '@/lib/stripe';
import { opsAlert } from '@/server/lib/ops/alert';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    // Highest-severity alert in the system. Every event Stripe sends is
    // rejected while this is failing, which means a customer can complete a
    // payment and never be upgraded — the exact billing bug this endpoint has
    // already produced once. A rotated/mismatched STRIPE_WEBHOOK_SECRET is
    // otherwise completely silent from our side: Stripe sees 400s, we see
    // nothing, and the customer sees a Free plan they just paid to leave.
    await opsAlert({
      event: 'billing.webhook.signature_invalid',
      severity: 'CRITICAL',
      message:
        'Stripe webhook signature verification FAILED — subscription events are being rejected. ' +
        'Check STRIPE_WEBHOOK_SECRET matches the endpoint secret in the Stripe dashboard.',
      context: {
        reason: err instanceof Error ? err.message : 'Unknown',
        hasSignatureHeader: Boolean(sig),
        secretConfigured: Boolean(webhookSecret),
      },
    });
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

        // Both of the next two branches are "money moved, entitlement did
        // not". They return 400, Stripe stops retrying after its window, and
        // the customer stays on their old plan indefinitely. These must page.
        if (!organizationId) {
          await opsAlert({
            event: 'billing.webhook.missing_organization_id',
            severity: 'CRITICAL',
            message:
              `Subscription ${subscription.id} has no organizationId in metadata — ` +
              'the paying customer will NOT be upgraded.',
            context: { subscriptionId: subscription.id, customerId: subscription.customer, eventType: event.type },
          });
          return NextResponse.json({ error: 'No organizationId' }, { status: 400 });
        }

        const priceId = subscription.items.data[0]?.price.id;
        const plan = await prisma.plan.findFirst({
          where: { stripePriceId: priceId },
        });

        if (!plan) {
          await opsAlert({
            event: 'billing.webhook.unknown_price_id',
            severity: 'CRITICAL',
            message:
              `No Plan row matches Stripe priceId ${priceId} — org ${organizationId} paid ` +
              'but cannot be mapped to a plan. Seed/repair the Plan table.',
            context: { priceId, organizationId, subscriptionId: subscription.id },
          });
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
    // Signature was valid, so this is a genuine Stripe event we failed to
    // apply — a DB outage mid-upgrade, a constraint violation, etc. Stripe
    // will retry a 500, but only for a bounded window.
    await opsAlert({
      event: 'billing.webhook.processing_error',
      severity: 'CRITICAL',
      message: `Failed to process Stripe event ${event.type} (${event.id}): ${err instanceof Error ? err.message : 'Unknown'}`,
      context: { eventId: event.id, eventType: event.type },
    });
    return NextResponse.json(
      { error: `Server error: ${err instanceof Error ? err.message : 'Unknown'}` },
      { status: 500 }
    );
  }
}
