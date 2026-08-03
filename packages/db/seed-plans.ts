import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Phase 3c — plans carry BOTH providers' identifiers.
//
// A Razorpay Plan ID (plan_…) is its own object with its own amount and
// currency, created in the Razorpay dashboard or API. It is NOT interchangeable
// with a Stripe Price ID (price_…), so it gets its own column and its own env
// var. A row can hold both, which is what lets one plan be sold through either
// provider without a re-seed when the deployment switches.
//
// `currency` matters: Razorpay India sells in INR while these prices were
// originally authored in USD. Set BILLING_CURRENCY=INR (and real INR amounts
// below) when seeding for the Razorpay path, or the UI will render a rupee
// plan with a dollar sign.
const currency = process.env.BILLING_CURRENCY || 'USD';

async function main() {
  // Create Free plan
  await prisma.plan.upsert({
    where: { name: 'free' },
    update: {
      displayName: 'Free',
      stripePriceId: null,
      razorpayPlanId: null,
      price: 0,
      currency,
      limits: {
        users: 5,
        frameworks: 3,
        storageMb: 100,
      },
      features: {
        apiAccess: false,
        sso: false,
        advancedAutomation: false,
        aiAdvisor: false,
      },
    },
    create: {
      name: 'free',
      displayName: 'Free',
      stripePriceId: null,
      razorpayPlanId: null,
      price: 0,
      currency,
      limits: {
        users: 5,
        frameworks: 3,
        storageMb: 100,
      },
      features: {
        apiAccess: false,
        sso: false,
        advancedAutomation: false,
        aiAdvisor: false,
      },
    },
  });

  // Create Pro plan
  await prisma.plan.upsert({
    where: { name: 'pro' },
    update: {
      displayName: 'Pro',
      stripePriceId: process.env.STRIPE_PRODUCT_PRO || 'price_test_pro',
      razorpayPlanId: process.env.RAZORPAY_PLAN_PRO || null,
      price: Number(process.env.BILLING_PRICE_PRO ?? 99),
      currency,
      limits: {
        users: 25,
        frameworks: 15,
        storageMb: 5000,
      },
      features: {
        apiAccess: true,
        sso: false,
        advancedAutomation: true,
        aiAdvisor: false,
      },
    },
    create: {
      name: 'pro',
      displayName: 'Pro',
      stripePriceId: process.env.STRIPE_PRODUCT_PRO || 'price_test_pro',
      razorpayPlanId: process.env.RAZORPAY_PLAN_PRO || null,
      price: Number(process.env.BILLING_PRICE_PRO ?? 99),
      currency,
      limits: {
        users: 25,
        frameworks: 15,
        storageMb: 5000,
      },
      features: {
        apiAccess: true,
        sso: false,
        advancedAutomation: true,
        aiAdvisor: false,
      },
    },
  });

  // Create Enterprise plan
  await prisma.plan.upsert({
    where: { name: 'enterprise' },
    update: {
      displayName: 'Enterprise',
      stripePriceId: process.env.STRIPE_PRODUCT_ENTERPRISE || 'price_test_enterprise',
      razorpayPlanId: process.env.RAZORPAY_PLAN_ENTERPRISE || null,
      price: Number(process.env.BILLING_PRICE_ENTERPRISE ?? 999),
      currency,
      limits: {
        users: 9999,
        frameworks: 9999,
        storageMb: 100000,
      },
      features: {
        apiAccess: true,
        sso: true,
        advancedAutomation: true,
        aiAdvisor: true,
        whiteLabel: true,
        auditLogs: true,
      },
    },
    create: {
      name: 'enterprise',
      displayName: 'Enterprise',
      stripePriceId: process.env.STRIPE_PRODUCT_ENTERPRISE || 'price_test_enterprise',
      razorpayPlanId: process.env.RAZORPAY_PLAN_ENTERPRISE || null,
      price: Number(process.env.BILLING_PRICE_ENTERPRISE ?? 999),
      currency,
      limits: {
        users: 9999,
        frameworks: 9999,
        storageMb: 100000,
      },
      features: {
        apiAccess: true,
        sso: true,
        advancedAutomation: true,
        aiAdvisor: true,
        whiteLabel: true,
        auditLogs: true,
      },
    },
  });

  console.log(`Plans seeded successfully (currency: ${currency})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
