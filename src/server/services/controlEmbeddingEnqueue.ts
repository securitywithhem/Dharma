/**
 * src/server/services/controlEmbeddingEnqueue.ts
 *
 * Safe, fire-and-forget entry point for queuing bulk control embeddings from
 * the framework/onboarding seed paths (item 4.2b).
 *
 * This wrapper exists for one specific reason: importing
 * `@/server/queue/controlEmbeddingQueue` constructs a BullMQ `Queue` — and
 * therefore opens a Redis connection — at MODULE LOAD time. Both
 * `tests/framework.test.ts` and `tests/onboarding-router.test.ts` import their
 * routers directly and mock no queues, so a top-level import in those routers
 * would open Redis inside the jest process and hang teardown. Deferring to a
 * dynamic `import()` inside the function keeps module load side-effect free.
 *
 * Failures are swallowed by design. A missing embedding only degrades AI
 * mapping suggestions — `suggestMappings()` fails open to "no suggestions" —
 * and must never break creating a framework or completing onboarding. The
 * backfill script (scripts/backfill-control-embeddings.ts) is the repair path.
 */

export async function enqueueControlEmbeddingsSafely(controlIds: string[]): Promise<void> {
  if (controlIds.length === 0) return;

  try {
    const { enqueueControlEmbeddings } = await import("@/server/queue/controlEmbeddingQueue");
    await enqueueControlEmbeddings(controlIds);
  } catch (err) {
    console.warn(
      `[control-embedding] Could not enqueue ${controlIds.length} control(s) for embedding — ` +
        `AI cross-walk suggestions will be unavailable for them until ` +
        `\`npm run backfill:control-embeddings\` is run:`,
      err instanceof Error ? err.message : err,
    );
  }
}
