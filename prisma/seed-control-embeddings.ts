#!/usr/bin/env tsx
/**
 * prisma/seed-control-embeddings.ts
 *
 * One-off script that backfills 384-dimensional Ollama embeddings for every
 * Control row that does not yet have one.
 *
 * Usage:
 *   npx tsx prisma/seed-control-embeddings.ts
 *
 * Prerequisites:
 *   - Ollama running locally on http://localhost:11434
 *   - `nomic-embed-text` model pulled:  ollama pull nomic-embed-text
 *   - DATABASE_URL set in environment / .env
 *
 * The script is idempotent: already-embedded controls are skipped.
 * On per-control failure the error is logged and the script continues.
 */

import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";
const BATCH_SIZE = 5; // controls processed in parallel per round
const EXPECTED_DIMS = 384;

// ---------------------------------------------------------------------------
// Ollama helpers
// ---------------------------------------------------------------------------

interface OllamaEmbedResponse {
  embedding: number[];
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    signal: AbortSignal.timeout(60_000), // 60 s per control
  });

  if (!res.ok) {
    throw new Error(
      `Ollama returned ${res.status} ${res.statusText} for embedding request`,
    );
  }

  const data = (await res.json()) as OllamaEmbedResponse;

  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("Ollama returned an empty or invalid embedding array");
  }

  if (data.embedding.length !== EXPECTED_DIMS) {
    console.warn(
      `  ⚠  Expected ${EXPECTED_DIMS}-dim vector but got ${data.embedding.length}-dim — storing anyway`,
    );
  }

  return data.embedding.slice(0, 384);
}

function vectorToSql(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const prisma = new PrismaClient({
    log: ["warn", "error"],
  });

  console.log("🔍  Fetching controls without embeddings…");

  // Raw SQL so we can filter by embedding IS NULL (Unsupported field)
  const controls = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; description: string; domain: string }>
  >(
    `SELECT id, title, description, domain
       FROM "Control"
      WHERE embedding IS NULL
      ORDER BY "createdAt" ASC`,
  );

  if (controls.length === 0) {
    console.log("✅  All controls already have embeddings. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`📋  ${controls.length} control(s) need embeddings.`);
  console.log(`🤖  Using model: ${EMBED_MODEL} @ ${OLLAMA_BASE_URL}\n`);

  let successCount = 0;
  let errorCount = 0;

  // Process in batches to avoid overwhelming Ollama
  for (let i = 0; i < controls.length; i += BATCH_SIZE) {
    const batch = controls.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (control) => {
        const ordinal = i + batch.indexOf(control) + 1;
        const prefix = `  [${ordinal}/${controls.length}]`;

        // Concatenate title + domain + description for a rich semantic signal
        const text = `${control.domain}: ${control.title} — ${control.description}`;

        try {
          process.stdout.write(
            `${prefix} Embedding "${control.title.slice(0, 50)}…" `,
          );

          const embedding = await getEmbedding(text);
          const vectorSql = vectorToSql(embedding);

          await prisma.$executeRawUnsafe(
            `UPDATE "Control" SET embedding = $1::vector WHERE id = $2`,
            vectorSql,
            control.id,
          );

          process.stdout.write(`✓ (${embedding.length}d)\n`);
          successCount++;
        } catch (err) {
          process.stdout.write(`✗\n`);
          console.error(
            `${prefix} ERROR for control ${control.id}: ${(err as Error).message}`,
          );
          errorCount++;
        }
      }),
    );
  }

  console.log(`\n🏁  Done.`);
  console.log(`    ✅ Succeeded: ${successCount}`);
  if (errorCount > 0) {
    console.log(`    ❌ Failed:    ${errorCount}`);
    console.log(`    Re-run the script to retry failed controls.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
