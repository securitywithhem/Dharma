/**
 * tests/scanAnomaly.test.ts
 *
 * WAVE 0.4 — dedicated coverage for src/server/pentest/scanAnomaly.ts.
 *
 * fix-log.md flagged this as a gap: 0.4 is exercised indirectly through
 * pentest.router.test.ts's create path, but the module's own contract
 * (breadth not volume, sliding window, advisory-null on Redis failure)
 * had no dedicated test. This talks to a real Redis (same convention as
 * connector.rateLimit.test.ts — no ioredis mock exists anywhere in this
 * repo), using REDIS_URL from the environment.
 */

import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import {
  recordScanTarget,
  closeScanAnomalyRedis,
  SPREAD_THRESHOLD,
  SPREAD_WINDOW_SECONDS,
} from "@/server/pentest/scanAnomaly";

function uniqueOrgId(): string {
  return `scan-anomaly-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("scanAnomaly.recordScanTarget", () => {
  afterAll(async () => {
    await closeScanAnomalyRedis();
  });

  it("reports non-anomalous while distinct targets stay under the threshold", async () => {
    const org = uniqueOrgId();

    let last;
    for (let i = 0; i < SPREAD_THRESHOLD - 1; i++) {
      last = await recordScanTarget(org, `target-${i}.example.com`);
    }

    expect(last).not.toBeNull();
    expect(last?.distinctTargets).toBe(SPREAD_THRESHOLD - 1);
    expect(last?.threshold).toBe(SPREAD_THRESHOLD);
    expect(last?.windowSeconds).toBe(SPREAD_WINDOW_SECONDS);
    expect(last?.anomalous).toBe(false);
  });

  it("flips anomalous once distinct targets reach the threshold", async () => {
    const org = uniqueOrgId();

    let last;
    for (let i = 0; i < SPREAD_THRESHOLD; i++) {
      last = await recordScanTarget(org, `target-${i}.example.com`);
    }

    expect(last?.distinctTargets).toBe(SPREAD_THRESHOLD);
    expect(last?.anomalous).toBe(true);
  });

  it("counts breadth, not volume — repeating the same target never advances the count", async () => {
    const org = uniqueOrgId();

    await recordScanTarget(org, "same-target.example.com");
    await recordScanTarget(org, "same-target.example.com");
    const last = await recordScanTarget(org, "same-target.example.com");

    expect(last?.distinctTargets).toBe(1);
    expect(last?.anomalous).toBe(false);
  });

  it("keeps a per-organization window — a second org starts at zero", async () => {
    const orgA = uniqueOrgId();
    const orgB = uniqueOrgId();

    for (let i = 0; i < 5; i++) {
      await recordScanTarget(orgA, `a-target-${i}.example.com`);
    }
    const bResult = await recordScanTarget(orgB, "b-target-0.example.com");

    expect(bResult?.distinctTargets).toBe(1);
  });

  describe("when Redis is unreachable", () => {
    const originalRedisUrl = process.env.REDIS_URL;

    beforeEach(async () => {
      // Force a fresh module instance so the cached client from the
      // describe blocks above (pointed at a real, reachable Redis) can't
      // leak into this one — recordScanTarget caches its connection at
      // module scope by design (see the module's own header comment).
      await closeScanAnomalyRedis();
      jest.resetModules();
      process.env.REDIS_URL = "redis://127.0.0.1:1"; // nothing listens here
    });

    afterAll(() => {
      process.env.REDIS_URL = originalRedisUrl;
      jest.resetModules();
    });

    it("returns null instead of throwing, so a scan is never blocked by a monitoring outage", async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const isolated = require("@/server/pentest/scanAnomaly");
      const result = await isolated.recordScanTarget(uniqueOrgId(), "target.example.com");
      expect(result).toBeNull();
      await isolated.closeScanAnomalyRedis();
    });
  });
});
