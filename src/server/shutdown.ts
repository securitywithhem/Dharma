/**
 * src/server/shutdown.ts
 *
 * Graceful shutdown handler for the Dharma Next.js / Node.js process.
 *
 * Listens for SIGINT and SIGTERM, then:
 *   1. Stops accepting new HTTP connections.
 *   2. Drains in-flight requests (up to SHUTDOWN_TIMEOUT).
 *   3. Disconnects Prisma (PostgreSQL connection pool).
 *   4. Disconnects the BullMQ connection (ioredis) if available.
 *   5. Exits with code 0 on success, 1 on timeout.
 *
 * Usage (in a standalone server or instrumentation.ts):
 *   import { setupGracefulShutdown } from "@/server/shutdown";
 *   setupGracefulShutdown();
 *
 * For Next.js App Router the shutdown is handled automatically by the
 * platform (Vercel, Docker). This file is most useful when running
 * `node server.js` directly or in the BullMQ worker process.
 */

import type { Server } from "http";
import { prisma } from "@/server/db";

/** Maximum time (ms) to wait for in-flight work before force-exiting. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

let _shutdownInitiated = false;

/**
 * Register process signal handlers for clean teardown.
 *
 * @param server  Optional HTTP server to stop accepting connections.
 *                Pass `null` for worker processes that have no server.
 */
export function setupGracefulShutdown(server?: Server | null): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      // Guard against double-invocation (SIGTERM + SIGINT arriving together)
      if (_shutdownInitiated) {
        console.warn(`[shutdown] ${signal} received again – already shutting down.`);
        return;
      }
      _shutdownInitiated = true;

      console.log(`\n[shutdown] ${signal} received. Starting graceful shutdown…`);

      // Force-exit watchdog
      const forceExitTimer = setTimeout(() => {
        console.error("[shutdown] ⚠️  Graceful shutdown timed out. Force exiting.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      // Don't keep the event loop alive for this timer
      forceExitTimer.unref();

      try {
        // ── 1. Stop HTTP server (no new connections) ─────────────────────
        if (server) {
          await new Promise<void>((resolve, reject) => {
            server.close((err) => {
              if (err) {
                reject(err);
              } else {
                console.log("[shutdown] HTTP server closed.");
                resolve();
              }
            });
          });
        }

        // ── 2. Disconnect Prisma ─────────────────────────────────────────
        await prisma.$disconnect();
        console.log("[shutdown] Prisma (PostgreSQL) disconnected.");

        // ── 3. Close BullMQ/ioredis connections if present ───────────────
        // Workers hold their own Redis connections; they should call
        // worker.close() before this handler fires. We do a best-effort
        // cleanup here for any stray connections.
        try {
          const { evidenceQueue } = await import("@/workers/classification");
          await evidenceQueue.close();
          console.log("[shutdown] BullMQ evidence queue closed.");
        } catch {
          // Not a fatal error – worker may not be loaded in this process
        }

        clearTimeout(forceExitTimer);
        console.log("[shutdown] ✅ Graceful shutdown complete. Exiting.");
        process.exit(0);
      } catch (err) {
        console.error("[shutdown] ❌ Error during graceful shutdown:", err);
        clearTimeout(forceExitTimer);
        process.exit(1);
      }
    });
  });

  console.log("[shutdown] Graceful shutdown handlers registered (SIGINT, SIGTERM).");
}
