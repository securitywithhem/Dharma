/**
 * scripts/backfill-control-embeddings.ts
 *
 * Item 4.2b — idempotent backfill of Control.embedding.
 *
 * Why this exists: `enqueueControlEmbedding` was only ever called from
 * `control.createChild`. Both bulk seed paths — `framework.create`'s
 * `control.createMany` and onboarding's per-domain `control.create` — never
 * enqueued anything, so effectively every real control has `embedding IS NULL`.
 * `suggestMappings()` filters on `embedding IS NOT NULL`, which is why the
 * cross-walk picker's AI suggestions always came back empty and the overlap
 * matrix had nothing to propose from.
 *
 * The forward fix (bulk enqueue on seed) is in framework.ts / onboarding.ts;
 * this script is for everything already in the database.
 *
 * Usage:
 *   npm run backfill:control-embeddings -- --dry-run
 *   npm run backfill:control-embeddings -- --org <orgId> --concurrency 4
 *
 *   DATABASE_URL='postgresql://dharma:dharmapass@localhost:5432/dharma_db?schema=public' \
 *     npx tsx scripts/backfill-control-embeddings.ts
 *
 * Calls embedControl() directly rather than going through the BullMQ queue, so
 * it needs no Redis and no running worker — safe to `docker exec` against a
 * deployment.
 */

import { PrismaClient } from "@prisma/client";
import { embedControl } from "@/server/services/controlEmbeddings";
import { env } from "@/env";

const prisma = new PrismaClient();

export interface BackfillOptions {
  organizationId?: string;
  frameworkId?: string;
  limit: number;
  retryFailed: boolean;
}

/**
 * Ids of controls that still need an embedding.
 *
 * Raw SQL is mandatory here, not a preference: `Control.embedding` is
 * `Unsupported("vector(384)")`, which Prisma will neither select nor filter on,
 * so `embedding IS NULL` is simply unreachable through the client.
 *
 * Exported for unit testing — the CLI wrapper below stays thin.
 */
export async function selectControlsNeedingEmbedding(
  db: Pick<PrismaClient, "$queryRawUnsafe">,
  opts: BackfillOptions,
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id
       FROM "Control" c
       JOIN "Framework" f ON f.id = c."frameworkId"
      WHERE c.embedding IS NULL
        AND ($1::text IS NULL OR f."organizationId" = $1)
        AND ($2::text IS NULL OR c."frameworkId" = $2)
        AND ($3::boolean OR c."embeddingStatus" <> 'FAILED')
      ORDER BY c."frameworkId", c.id
      LIMIT $4`,
    opts.organizationId ?? null,
    opts.frameworkId ?? null,
    opts.retryFailed,
    opts.limit,
  );
  return rows.map((r) => r.id);
}

/**
 * Confirms Ollama is reachable BEFORE any control is touched.
 *
 * This is the most important safeguard in the script. `embedControl` is
 * deliberately best-effort — it swallows every error and records
 * `embeddingStatus = 'FAILED'` with an incremented attempt counter. Running the
 * backfill against an unreachable Ollama would therefore not fail loudly; it
 * would quietly mark every control in the database as FAILED, and those rows
 * are then skipped on later runs unless --retry-failed is passed. One bad run
 * would poison the retry state for the entire table.
 */
async function assertOllamaReachable(): Promise<void> {
  const url = `${env.OLLAMA_BASE_URL.replace(/\/$/, "")}/api/tags`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    throw new Error(
      `Ollama is unreachable at ${env.OLLAMA_BASE_URL} (${err instanceof Error ? err.message : String(err)}). ` +
        `Refusing to run: every control would be marked FAILED. Start Ollama and retry.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status} from ${url}. Refusing to run.`);
  }
}

function parseArgs(argv: string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    organizationId: value("--org"),
    frameworkId: value("--framework"),
    limit: Number(value("--limit") ?? 100_000),
    // Default 2 matches CONTROL_EMBEDDING_WORKER_CONCURRENCY's default: the
    // embedding model is CPU-bound, so more parallelism mostly thrashes.
    concurrency: Math.max(1, Number(value("--concurrency") ?? 2)),
    retryFailed: argv.includes("--retry-failed"),
    dryRun: argv.includes("--dry-run"),
    allowPartial: argv.includes("--allow-partial"),
  };
}

/** Bounded worker pool — keeps at most `concurrency` embeddings in flight. */
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
      const done = index + 1;
      if (done % 25 === 0) console.log(`  … ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const ids = await selectControlsNeedingEmbedding(prisma, {
    organizationId: args.organizationId,
    frameworkId: args.frameworkId,
    limit: args.limit,
    retryFailed: args.retryFailed,
  });

  console.log(`${ids.length} control(s) need an embedding.`);
  if (ids.length === 0) {
    console.log("Nothing to do. ✔");
    return;
  }

  if (args.dryRun) {
    console.log("--dry-run: no embeddings generated.");
    return;
  }

  await assertOllamaReachable();
  console.log(`Ollama reachable. Embedding at concurrency ${args.concurrency}…`);

  await runPool(ids, args.concurrency, (id) => embedControl(prisma, id));

  // Reconcile against the database rather than trusting in-process counters —
  // embedControl never throws, so a count of "attempted" proves nothing.
  const [{ remaining }] = await prisma.$queryRawUnsafe<{ remaining: bigint }[]>(
    `SELECT COUNT(*)::bigint AS remaining
       FROM "Control" c
       JOIN "Framework" f ON f.id = c."frameworkId"
      WHERE c.embedding IS NULL
        AND ($1::text IS NULL OR f."organizationId" = $1)
        AND ($2::text IS NULL OR c."frameworkId" = $2)`,
    args.organizationId ?? null,
    args.frameworkId ?? null,
  );

  const stillNull = Number(remaining);
  console.log(`Attempted ${ids.length}. Controls still without an embedding: ${stillNull}.`);

  if (stillNull > 0 && !args.allowPartial) {
    throw new Error(
      `${stillNull} control(s) still have no embedding. Inspect Control.embeddingError, ` +
        `then re-run with --retry-failed (or --allow-partial to accept this).`,
    );
  }
  console.log("Backfill verified. ✔");
}

// `require.main === module` guard: the selection helper above is imported by
// tests, and importing this file must not kick off a backfill.
if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
