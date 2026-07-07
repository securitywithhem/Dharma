import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create Free plan
  await prisma.plan.upsert({
    where: { name: 'free' },
    update: {
      displayName: 'Free',
      stripePriceId: null,
      price: 0,
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
      price: 0,
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
      price: 99,
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
      price: 99,
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
      price: 999,
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
      price: 999,
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

  console.log('Plans seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
