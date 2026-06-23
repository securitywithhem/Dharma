/**
 * src/app/api/status/route.ts
 *
 * GET /api/status
 *
 * Comprehensive service status check for all Dharma backing services.
 * Returns a detailed JSON report with per-service health, latency, and metadata.
 *
 * This endpoint is intended for:
 *   - Operations dashboards
 *   - External uptime monitors (e.g., UptimeRobot, Better Uptime)
 *   - Docker HEALTHCHECK (if more detail is needed than /api/health)
 *
 * Returns HTTP 200 when all services are healthy.
 * Returns HTTP 503 when one or more services are degraded.
 *
 * Response shape:
 * {
 *   status:   "healthy" | "degraded",
 *   uptime:   number,        // Node.js process uptime in seconds
 *   version:  string,
 *   timestamp: string,       // ISO 8601
 *   services: {
 *     postgres: ServiceCheck,
 *     redis:    ServiceCheck,
 *     minio:    ServiceCheck,
 *     ollama:   ServiceCheck,
 *   }
 * }
 *
 * ServiceCheck: { healthy: boolean, latencyMs?: number, detail?: unknown, error?: string }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { minioClient, BUCKET_NAME } from "@/server/minio";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Timeout helper ─────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Service check types ────────────────────────────────────────────────────
interface ServiceCheck {
  healthy: boolean;
  latencyMs?: number;
  detail?: unknown;
  error?: string;
}

// ── Individual checks ──────────────────────────────────────────────────────

async function checkPostgres(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const [row] = await withTimeout(
      prisma.$queryRaw<[{ version: string }]>`SELECT version() as version`,
      5000
    );
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      detail: { version: (row?.version ?? "").split(" ").slice(0, 2).join(" ") },
    };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

async function checkRedis(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const { default: Redis } = await import("ioredis");
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const url = new URL(redisUrl);

    const client = new Redis({
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    client.on("error", () => { /* suppress */ });
    await client.connect();

    const [pong, dbSize] = await Promise.all([
      client.ping(),
      client.dbsize(),
    ]);

    const info = await client.info("server");
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const redisVersion = versionMatch?.[1]?.trim() ?? "unknown";

    await client.quit();

    return {
      healthy: pong === "PONG",
      latencyMs: Date.now() - start,
      detail: { version: redisVersion, keys: dbSize },
    };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

async function checkMinio(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const exists = await withTimeout(
      minioClient.bucketExists(BUCKET_NAME),
      5000
    );
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      detail: { bucket: BUCKET_NAME, exists },
    };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

async function checkOllama(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const response = await withTimeout(
      fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }),
      6000
    );
    if (!response.ok) {
      return { healthy: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const data = (await response.json()) as { models?: Array<{ name: string; size?: number }> };
    const models = data.models?.map((m) => ({ name: m.name })) ?? [];
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      detail: { models, modelCount: models.length },
    };
  } catch (err) {
    return { healthy: false, error: String(err) };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET() {
  const requestStart = Date.now();
  const timestamp = new Date().toISOString();

  const [postgres, redis, minio, ollama] = await Promise.allSettled([
    checkPostgres(),
    checkRedis(),
    checkMinio(),
    checkOllama(),
  ]).then((results) =>
    results.map((r): ServiceCheck =>
      r.status === "fulfilled"
        ? r.value
        : { healthy: false, error: String(r.reason) }
    )
  );

  const services = { postgres, redis, minio, ollama };
  const allHealthy = Object.values(services).every((s) => s.healthy);
  const overallStatus = allHealthy ? "healthy" : "degraded";
  const httpStatus = allHealthy ? 200 : 503;

  const body = {
    status: overallStatus,
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version ?? "0.1.0",
    timestamp,
    responseTimeMs: Date.now() - requestStart,
    services,
  };

  if (!allHealthy) {
    logger.warn(
      { services, responseTimeMs: body.responseTimeMs },
      "Service status check: DEGRADED"
    );
  }

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}
