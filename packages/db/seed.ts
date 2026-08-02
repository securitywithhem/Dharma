import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

// Names this seed used to create, superseded by the canonical names in
// data/frameworks/*.json. Cleaned up so existing dev/demo databases converge
// on one framework per standard instead of keeping the empty legacy row.
const LEGACY_FRAMEWORK_STUBS = ["ISO 27001", "SOC 2"];

/**
 * Delete the superseded framework stubs.
 *
 * The safety test is evidence, not controls. These stubs pick up placeholder
 * controls from framework.create()'s auto-seed, so a control count of zero is
 * too strict — it would strand "ISO 27001 (4 controls)" next to the real
 * "ISO 27001:2022 (24 controls)" forever. Uploaded evidence, by contrast, is
 * genuine user work that a cascading delete would destroy, so any stub with
 * evidence attached is kept and reported instead.
 */
async function removeLegacyFrameworkStubs(
  client: PrismaClient,
  organizationId: string,
) {
  const stubs = await client.framework.findMany({
    where: { organizationId, name: { in: LEGACY_FRAMEWORK_STUBS } },
    select: {
      id: true,
      name: true,
      controls: { select: { _count: { select: { evidence: true } } } },
    },
  });
  if (stubs.length === 0) return;

  const evidenceCount = (stub: (typeof stubs)[number]) =>
    stub.controls.reduce((sum, c) => sum + c._count.evidence, 0);

  const disposable = stubs.filter((s) => evidenceCount(s) === 0);
  const kept = stubs.filter((s) => evidenceCount(s) > 0);

  if (disposable.length > 0) {
    await client.framework.deleteMany({
      where: { id: { in: disposable.map((f) => f.id) } },
    });
    console.info(
      `Removed ${disposable.length} legacy framework stub(s): ${disposable
        .map((f) => f.name)
        .join(", ")}`,
    );
  }

  if (kept.length > 0) {
    console.warn(
      `Kept legacy framework(s) with evidence attached — migrate the evidence, then delete manually: ${kept
        .map((f) => `${f.name} (${evidenceCount(f)} evidence items)`)
        .join(", ")}`,
    );
  }
}

export async function seedDatabase(client: PrismaClient) {
  const organization = await client.organization.upsert({
    where: { id: "org-default" },
    update: {
      name: "Dharma Demo Organization",
      lockKeyId: 1
    },
    create: {
      id: "org-default",
      name: "Dharma Demo Organization",
      lockKeyId: 1
    }
  });

  // Frameworks are NOT seeded here any more.
  //
  // This used to createMany() three control-less stubs named "ISO 27001",
  // "SOC 2" and "DPDP Act 2023". scripts/seed-frameworks.ts then upserts the
  // real, control-bearing frameworks from data/frameworks/*.json under their
  // canonical names — "ISO 27001:2022" and "SOC 2 Type II". Because the names
  // differ, that upsert never matched the stubs, so `npm run seed:all` left
  // the Certification Goals view showing each framework twice: once empty,
  // once populated. (DPDP escaped it only because both files happened to use
  // the same name.) skipDuplicates could not help — the rows are not
  // duplicates by the organizationId_name unique key.
  //
  // seed-frameworks.ts is the single source of truth; run it via
  // `npm run seed:frameworks` (or `seed:all`).
  await removeLegacyFrameworkStubs(client, organization.id);

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
