import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

export async function seedDatabase(client: PrismaClient) {
  const organization = await client.organization.upsert({
    where: { id: "org-default" },
    update: {
      name: "Dharma Demo Organization"
    },
    create: {
      id: "org-default",
      name: "Dharma Demo Organization"
    }
  });

  await client.framework.createMany({
    data: [
      {
        name: "DPDP Act 2023",
        version: "2023",
        description:
          "India's Digital Personal Data Protection Act baseline framework.",
        organizationId: organization.id
      },
      {
        name: "ISO 27001",
        version: "2022",
        description: "Information security management system controls.",
        organizationId: organization.id
      },
      {
        name: "SOC 2",
        version: "Type II",
        description: "Trust service criteria controls for SaaS readiness.",
        organizationId: organization.id
      }
    ],
    skipDuplicates: true
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();

  if (adminEmail) {
    await client.user.upsert({
      where: { email: adminEmail },
      update: {
        role: Role.ADMIN,
        organizationId: organization.id
      },
      create: {
        email: adminEmail,
        name: "Seed Administrator",
        role: Role.ADMIN,
        organizationId: organization.id
      }
    });
  }

  return { organizationId: organization.id };
}

async function main() {
  const result = await seedDatabase(prisma);
  console.info("Seeded Dharma foundation", result);
}

if (!process.env.JEST_WORKER_ID) {
  main()
    .catch((error) => {
      console.error("Failed to seed Dharma foundation", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
