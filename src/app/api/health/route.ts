/**
 * src/app/api/health/route.ts
 *
 * HTTP GET /api/health
 *
 * Lightweight liveness probe used by Docker HEALTHCHECK and load balancers.
 * Performs a quick PostgreSQL connectivity check.
 * For a full service status report, use the tRPC health.checkAll procedure.
 *
 * Returns:
 *   200 { status: "ok", service: "dharma", version: string, timestamp: string }
 *   503 { status: "error", error: string, timestamp: string }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

// Force Node.js runtime (not Edge) since we use Prisma
export const runtime = "nodejs";

// Allow this route to be called without auth (no middleware checks)
export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    // Quick liveness check – single row query with timeout
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database health check timed out")), 5000)
      ),
    ]);

    return NextResponse.json(
      {
        status: "ok",
        service: "dharma",
        version: process.env.npm_package_version ?? "0.1.0",
        uptime: Math.floor(process.uptime()),
        timestamp,
      },
      {
        status: 200,
        headers: {
          // Prevent caching of health responses
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown health check failure";

    // Log the failure (will appear in docker compose logs)
    console.error("[health] /api/health check failed:", message);

    return NextResponse.json(
      {
        status: "error",
        service: "dharma",
        error: message,
        timestamp,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Content-Type": "application/json",
        },
      }
    );
  }
}
