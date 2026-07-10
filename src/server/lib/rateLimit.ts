import { TRPCError } from "@trpc/server";

/**
 * Minimal in-process fixed-window rate limiter. Dharma is a self-hosted,
 * single-process-per-deployment app (see docs/2_TRD.md's Docker Compose
 * architecture) — an in-memory Map is sufficient here and avoids adding a
 * Redis round-trip to every call of a rate-limited procedure. If Dharma
 * ever runs multiple Next.js replicas behind a load balancer, this should
 * move to a Redis-backed counter instead.
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

/**
 * Throws TRPCError("TOO_MANY_REQUESTS") if `key` has exceeded `maxRequests`
 * within the current `windowMs` window. Call at the top of a procedure,
 * keyed by something like `${organizationId}:${procedureName}`.
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  if (bucket.count >= maxRequests) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please wait before trying again.",
    });
  }

  bucket.count += 1;
}
