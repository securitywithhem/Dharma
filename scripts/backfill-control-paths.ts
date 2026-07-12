/**
 * scripts/backfill-control-paths.ts
 *
 * Phase 6, Part 1 — one-time (idempotent) backfill of the control hierarchy
 * materialized-path fields introduced by the `phase6_control_hierarchy` migration.
 *
 * For every Control it recomputes, from the `parentId` tree (the source of truth):
 *   - path       = array of ancestor IDs, root-first, INCLUDING self
 *   - depth      = number of ancestors (0 for roots)
 *   - sortOrder  = position among siblings, ordered by (createdAt, id)
 *
 * Pre-migration all controls are root-level, so this collapses to path=[id], depth=0,
 * but the algorithm is written generically so it stays correct if re-run after a
 * hierarchy has been built (e.g. as a repair tool).
 *
 * Usage (DB host differs between container and host shell — override as needed):
 *   DATABASE_URL='postgresql://dharma:dharmapass@localhost:5432/dharma_db?schema=public' \
 *     npx tsx scripts/backfill-control-paths.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  id: string;
  parentId: string | null;
  frameworkId: string;
  createdAt: Date;
};

async function main() {
  const controls: Row[] = await prisma.control.findMany({
    select: { id: true, parentId: true, frameworkId: true, createdAt: true },
  });

  const sourceCount = controls.length;
  console.log(`Loaded ${sourceCount} control(s).`);

  if (sourceCount === 0) {
    console.log("No controls to backfill. Done.");
    return;
  }

  // Index children by parentId (null → roots) so we can order siblings deterministically.
  const byParent = new Map<string | null, Row[]>();
  for (const c of controls) {
    const key = c.parentId;
    const bucket = byParent.get(key) ?? [];
    bucket.push(c);
    byParent.set(key, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => {
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
  }

  // BFS from roots, computing path/depth/sortOrder as we descend so a parent is
  // always processed before its children.
  const updates: { id: string; path: string[]; depth: number; sortOrder: number }[] = [];
  const queue: { id: string; parentPath: string[]; depth: number }[] = [];

  (byParent.get(null) ?? []).forEach((root, i) => {
    queue.push({ id: root.id, parentPath: [], depth: 0 });
    updates.push({ id: root.id, path: [root.id], depth: 0, sortOrder: i });
  });

  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    const selfPath = [...node.parentPath, node.id];
    (byParent.get(node.id) ?? []).forEach((child, i) => {
      updates.push({
        id: child.id,
        path: [...selfPath, child.id],
        depth: node.depth + 1,
        sortOrder: i,
      });
      queue.push({ id: child.id, parentPath: selfPath, depth: node.depth + 1 });
    });
  }

  // Detect orphans (parentId points at a missing/other-framework control): they never
  // get enqueued from a root, so `updates` would be short. Fail loudly rather than
  // silently leaving null paths.
  if (updates.length !== sourceCount) {
    const covered = new Set(updates.map((u) => u.id));
    const orphans = controls.filter((c) => !covered.has(c.id)).map((c) => c.id);
    throw new Error(
      `Backfill covered ${updates.length}/${sourceCount} controls. ` +
        `Orphaned (unreachable from a root) control IDs: ${orphans.join(", ")}`,
    );
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.control.update({
        where: { id: u.id },
        data: { path: u.path, depth: u.depth, sortOrder: u.sortOrder },
      }),
    ),
  );

  // Verify: no control should be left with a null path.
  const remainingNull = await prisma.control.count({ where: { path: { equals: Prisma.DbNull } } });

  console.log(
    `Backfilled ${updates.length} control(s). ` +
      `Rows still missing a path: ${remainingNull}. ` +
      `Source count: ${sourceCount}.`,
  );

  if (remainingNull !== 0 || updates.length !== sourceCount) {
    throw new Error("Backfill verification failed — counts do not reconcile.");
  }
  console.log("Backfill verified. ✔");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
