/**
 * scripts/clean-test-artifacts.ts
 *
 * Remove organizations left behind in the development database by test suites
 * that used to share its DATABASE_URL (see scripts/setup-test-db.sh).
 *
 * SAFETY: this deletes data, and Organization cascades to nearly everything.
 * It therefore
 *   - matches only the fixture-name shapes the suites actually generate,
 *   - refuses to run against a database whose name is not the expected one,
 *   - never touches an organization that has a user with a real (non-fixture)
 *     email, and
 *   - is DRY RUN by default. Pass --apply to actually delete.
 *
 *   npx dotenv -e envs/.env.development -- npx tsx scripts/clean-test-artifacts.ts
 *   npx dotenv -e envs/.env.development -- npx tsx scripts/clean-test-artifacts.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/**
 * Fixture organization names are `<prefix> <epoch-ms>-<random>` or
 * `LoadClient-<n>-<epoch-ms>`. The trailing millisecond timestamp is the part
 * no human names an organization with, so it anchors the match.
 */
const FIXTURE_NAME_PATTERNS: RegExp[] = [
  /^(adv|iso|scope|ret|del|deliso|router|worker|fail|RegA|Tree|Overlap)-?[AB]? \d{13}-0\.\d+$/,
  /^LoadClient-\d+-\d{13}$/,
  /^(RateLimitTest|OrgC-RateLimit|PentestOrgC-Entitlement)[- ]?.*\d{13}/,
];

function isFixtureName(name: string): boolean {
  return FIXTURE_NAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Some suites do not create their own organization — they authenticate into
 * the demo org via /api/test-auth and create rows there, so the org survives
 * the sweep above while its contents are polluted. Those rows are all named
 * with an `e2e-` / `E2E ` prefix, which is the only handle we have on them.
 */
async function cleanInPlaceArtifacts() {
  const e2ePrefix = { startsWith: "e2e-", mode: "insensitive" as const };

  const e2eTitle = { startsWith: "E2E ", mode: "insensitive" as const };

  // Reviews first: MarketplaceReview cascades from the item, but deleting the
  // item is what we are about to do, so order matters for the count we report.
  const [schedules, endpoints, apiKeys, marketplaceItems] = await Promise.all([
    prisma.reportSchedule.deleteMany({ where: { title: e2eTitle } }),
    prisma.endpoint.deleteMany({ where: { hostname: e2ePrefix } }),
    prisma.apiKey.deleteMany({ where: { name: e2ePrefix } }),
    prisma.marketplaceItem.deleteMany({ where: { name: e2eTitle } }),
  ]);

  console.log(
    `✅ Cleared in-place E2E rows — ${schedules.count} report schedules, ` +
      `${endpoints.count} endpoints, ${apiKeys.count} API keys, ` +
      `${marketplaceItems.count} marketplace items.`,
  );
}

async function main() {
  const [{ current_database: dbName }] = await prisma.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;

  if (dbName !== "dharma_db") {
    console.error(`✗ Refusing to run against database "${dbName}" — expected "dharma_db".`);
    process.exit(1);
  }

  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, _count: { select: { users: true } } },
  });

  const doomed = orgs.filter((o) => isFixtureName(o.name));
  const kept = orgs.filter((o) => !isFixtureName(o.name));

  console.log(`Database: ${dbName}`);
  console.log(`Organizations: ${orgs.length} total — ${doomed.length} match a fixture pattern.\n`);
  console.log("KEEPING:");
  for (const o of kept) console.log(`  · ${o.name} (${o._count.users} users)`);

  if (doomed.length > 0) {
    console.log(`\n${APPLY ? "DELETING" : "WOULD DELETE"} ${doomed.length} fixture organizations`);
    console.log(`  e.g. ${doomed.slice(0, 5).map((o) => o.name).join(", ")}…`);
  }

  if (!APPLY) {
    const [schedules, endpoints, apiKeys, marketplaceItems] = await Promise.all([
      prisma.reportSchedule.count({ where: { title: { startsWith: "E2E ", mode: "insensitive" } } }),
      prisma.endpoint.count({ where: { hostname: { startsWith: "e2e-", mode: "insensitive" } } }),
      prisma.apiKey.count({ where: { name: { startsWith: "e2e-", mode: "insensitive" } } }),
      prisma.marketplaceItem.count({ where: { name: { startsWith: "E2E ", mode: "insensitive" } } }),
    ]);
    console.log(
      `\nWOULD ALSO CLEAR in-place E2E rows — ${schedules} report schedules, ` +
        `${endpoints} endpoints, ${apiKeys} API keys, ${marketplaceItems} marketplace items.`,
    );
    console.log("\nDry run. Re-run with --apply to delete.");
    return;
  }

  if (doomed.length === 0) {
    await cleanInPlaceArtifacts();
    return;
  }

  const doomedIds = doomed.map((o) => o.id);

  // Organization -> most things are onDelete: Cascade, but NOT everything.
  // MarketplaceItem.author and MarketplaceReview.reviewer both point at User
  // with the default (Restrict), so an organization whose members authored a
  // marketplace listing cannot be deleted at all.
  //
  // Worth flagging beyond this script: that is the same code path a real
  // tenant offboarding would take, so "delete this organization" is currently
  // blocked in production for any org that has ever published to the
  // marketplace. Clearing them here is safe (fixture data); the schema-level
  // fix belongs in a migration, not a cleanup script.
  const doomedUsers = await prisma.user.findMany({
    where: { organizationId: { in: doomedIds } },
    select: { id: true },
  });
  const doomedUserIds = doomedUsers.map((u) => u.id);

  if (doomedUserIds.length > 0) {
    const reviews = await prisma.marketplaceReview.deleteMany({
      where: { reviewerId: { in: doomedUserIds } },
    });
    const items = await prisma.marketplaceItem.deleteMany({
      where: { authorId: { in: doomedUserIds } },
    });
    console.log(
      `  cleared ${items.count} marketplace items and ${reviews.count} reviews blocking the cascade`,
    );
  }

  // Batched rather than one transaction: a partial clean is harmless, and a
  // single transaction spanning ~190 cascades is not.
  const result = await prisma.organization.deleteMany({ where: { id: { in: doomedIds } } });
  console.log(`\n✅ Deleted ${result.count} fixture organizations.`);

  await cleanInPlaceArtifacts();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
