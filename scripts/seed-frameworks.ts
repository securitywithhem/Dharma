/**
 * scripts/seed-frameworks.ts
 *
 * Seeds compliance framework controls (DPDP Act 2023, ISO 27001:2022, SOC 2 Type II)
 * for all organizations in the database (or a specified org).
 *
 * Usage:
 *   npm run seed:frameworks
 *   SEED_ORG_ID=<orgId> npm run seed:frameworks
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

interface ControlData {
  id: string;
  title: string;
  description: string;
  guidance?: string;
}

interface DomainData {
  name: string;
  controls: ControlData[];
}

interface FrameworkData {
  frameworkName: string;
  version: string;
  description: string;
  domains: DomainData[];
}

const FRAMEWORK_FILES: string[] = [
  "dpdp-act-2023.json",
  "iso-27001-2022.json",
  "soc2-type2.json",
];

function loadFrameworkData(fileName: string): FrameworkData {
  const filePath = path.join(process.cwd(), "data", "frameworks", fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Framework data file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as FrameworkData;
}

async function seedFrameworkForOrg(
  organizationId: string,
  data: FrameworkData,
): Promise<void> {
  const totalControls = data.domains.reduce(
    (sum, d) => sum + d.controls.length,
    0,
  );

  console.log(
    `\n📋 Seeding "${data.frameworkName}" (v${data.version}) → org: ${organizationId}`,
  );
  console.log(
    `   ${data.domains.length} domains, ${totalControls} total controls`,
  );

  // Upsert the framework
  const framework = await prisma.framework.upsert({
    where: {
      organizationId_name: {
        organizationId,
        name: data.frameworkName,
      },
    },
    update: {
      version: data.version,
      description: data.description,
    },
    create: {
      name: data.frameworkName,
      version: data.version,
      description: data.description,
      organizationId,
    },
  });

  console.log(`   ✅ Framework record ready (id: ${framework.id})`);

  // Upsert all controls per domain
  let seededCount = 0;

  for (const domain of data.domains) {
    for (const controlData of domain.controls) {
      await prisma.control.upsert({
        where: { id: controlData.id },
        update: {
          title: controlData.title,
          description: controlData.description,
          guidance: controlData.guidance ?? null,
          domain: domain.name,
          // Do NOT reset status on update — preserve user progress
        },
        create: {
          id: controlData.id,
          frameworkId: framework.id,
          domain: domain.name,
          title: controlData.title,
          description: controlData.description,
          guidance: controlData.guidance ?? null,
          status: "NOT_STARTED",
        },
      });

      seededCount += 1;
    }

    const domainCount = domain.controls.length;
    console.log(
      `   ✓ ${domainCount} control${domainCount !== 1 ? "s" : ""} → "${domain.name}"`,
    );
  }

  console.log(`   🎯 ${seededCount}/${totalControls} controls seeded`);
}

async function main(): Promise<void> {
  console.log("🌱 Dharma Framework Seeder — Phase 0.2\n");
  console.log("=".repeat(50));

  // Resolve target organization(s)
  const targetOrgId = process.env.SEED_ORG_ID?.trim();

  let organizationIds: string[];

  if (targetOrgId) {
    // Validate the provided org ID
    const org = await prisma.organization.findUnique({
      where: { id: targetOrgId },
      select: { id: true, name: true },
    });

    if (!org) {
      throw new Error(
        `Organization with id "${targetOrgId}" not found. Run db:seed first.`,
      );
    }

    console.log(`🏢 Target organization: ${org.name} (${org.id})`);
    organizationIds = [org.id];
  } else {
    // Seed all organizations
    const orgs = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    if (orgs.length === 0) {
      throw new Error(
        "No organizations found. Run `npm run db:seed` first to create the default organization.",
      );
    }

    console.log(`🏢 Found ${orgs.length} organization(s) — seeding all`);
    organizationIds = orgs.map((o) => o.id);
  }

  // Load all framework data files
  const frameworkDataList = FRAMEWORK_FILES.map(loadFrameworkData);

  console.log(`\n📦 Loaded ${frameworkDataList.length} framework definitions`);

  // Seed each framework for each org
  for (const orgId of organizationIds) {
    console.log(`\n${"─".repeat(50)}`);

    for (const frameworkData of frameworkDataList) {
      await seedFrameworkForOrg(orgId, frameworkData);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`\n✅ Framework seeding completed successfully!`);
  console.log(`   Organizations seeded: ${organizationIds.length}`);
  console.log(`   Frameworks per org:   ${frameworkDataList.length}`);

  const totalControls = frameworkDataList.reduce(
    (sum, fw) =>
      sum + fw.domains.reduce((dSum, d) => dSum + d.controls.length, 0),
    0,
  );

  console.log(`   Controls per org:     ${totalControls}`);
  console.log(
    `   Total records:        ${organizationIds.length * totalControls}\n`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("\n❌ Seeding failed:");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
