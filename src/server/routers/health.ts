/**
 * src/server/routers/health.ts
 *
 * tRPC health check router.
 * Verifies connectivity to PostgreSQL, Redis, Ollama, MinIO, and — since
 * GH #25 — the embedding backend specifically, which can be broken while
 * Ollama itself answers happily.
 *
 * Endpoint: GET /api/trpc/health.checkAll
 * Auth: public (no session required – used by load balancers / monitoring)
 */

import { createTRPCRouter, publicProcedure } from "@/server/trpc";
import { prisma } from "@/server/db";
import { minioClient, BUCKET_NAME } from "@/server/minio";
import { checkAdvisorHealth } from "@/server/ai/advisorHealth";
import { opsAlert } from "@/server/lib/ops/alert";

// ── Redis health check using BullMQ's built-in ioredis ────────────────────
// BullMQ re-exports ioredis – we access it via a dynamic import to avoid
// bundling issues in the Next.js server component context.
async function checkRedis(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    // Parse Redis URL to extract host/port/password
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const url = new URL(redisUrl);

    const { default: Redis } = await import("ioredis");
    const client = new Redis({
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    client.on("error", () => { /* suppress – we surface errors below */ });

    await client.connect();
    const pong = await client.ping();
    await client.quit();

    if (pong === "PONG") {
      return { healthy: true, latencyMs: Date.now() - start };
    }
    return { healthy: false, error: "Unexpected PING response" };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

// ── PostgreSQL ─────────────────────────────────────────────────────────────
async function checkPostgres(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

// ── Ollama ─────────────────────────────────────────────────────────────────
async function checkOllama(): Promise<{ healthy: boolean; models?: string[]; error?: string }> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { healthy: false, error: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = data.models?.map((m) => m.name) ?? [];
    return { healthy: true, models };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

// ── MinIO ──────────────────────────────────────────────────────────────────
async function checkMinio(): Promise<{ healthy: boolean; bucket?: string; error?: string }> {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    return { healthy: true, bucket: exists ? BUCKET_NAME : "(not created yet)" };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

// ── Router ─────────────────────────────────────────────────────────────────
export const healthRouter = createTRPCRouter({
  /**
   * checkAll – full service health check.
   *
   * Response:
   * {
   *   status: "healthy" | "degraded",
   *   uptime: number,           // seconds since process start
   *   timestamp: string,        // ISO 8601
   *   checks: {
   *     postgres: { healthy: boolean, latencyMs?: number, error?: string },
   *     redis:    { healthy: boolean, latencyMs?: number, error?: string },
   *     ollama:   { healthy: boolean, models?: string[], error?: string },
   *     minio:    { healthy: boolean, bucket?: string,   error?: string },
   *     embedding:{ healthy: boolean, model: string, reason?: string, error?: string },
   *   }
   * }
   */
  checkAll: publicProcedure.query(async () => {
    const [postgres, redis, ollama, minio, advisor] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkOllama(),
      checkMinio(),
      // GH #25 — `ollama` above only proves the process answers /api/tags. The
      // advisor can pass that and still fail every single request: the
      // embedding model may not be pulled (Ollama 404s per-request), or it may
      // emit a dimension count the schema's vector(384) columns cannot store.
      // Both were invisible to this endpoint, so the operator's health page
      // read green while the Compliance Advisor was completely non-functional.
      checkAdvisorHealth(),
    ]);

    const embedding = {
      healthy: advisor.healthy,
      model: advisor.model,
      ...(advisor.reason ? { reason: advisor.reason } : {}),
      ...(advisor.compatibility.compatible
        ? {}
        : { error: advisor.compatibility.reason }),
    };

    const allHealthy =
      postgres.healthy &&
      redis.healthy &&
      ollama.healthy &&
      minio.healthy &&
      embedding.healthy;

    // GH #25 — raise an ops alert rather than waiting for a user to report it.
    //
    // Severity is split on the reason, which matters: DIMENSION_MISMATCH is a
    // misconfiguration that will never self-heal and silently poisons stored
    // vectors, so it pages. UNREACHABLE/MODEL_MISSING are usually a restarting
    // container or a pull in progress, and paging on those trains the operator
    // to ignore the channel.
    if (!advisor.healthy) {
      void opsAlert({
        event: "ai.embedding.unavailable",
        severity: advisor.reason === "DIMENSION_MISMATCH" ? "CRITICAL" : "WARN",
        message:
          "Embedding backend is not usable — the Compliance Advisor cannot perform retrieval.",
        context: { reason: advisor.reason, model: advisor.model },
      });
    }

    return {
      status: allHealthy ? ("healthy" as const) : ("degraded" as const),
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: {
        postgres,
        redis,
        ollama,
        minio,
        embedding,
      },
    };
  }),

  /**
   * ping – ultra-lightweight liveness probe.
   * No DB/service calls – used by Caddy active health checks.
   */
  ping: publicProcedure.query(() => ({
    alive: true,
    timestamp: new Date().toISOString(),
  })),
});
