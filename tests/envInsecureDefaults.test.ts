/**
 * WAVE 10.5 — the production secret guard covers the Helm placeholder set.
 *
 * Closes fullstack-audit-2026-08-06 DEV-6: src/env.ts denied the exact strings
 * shipped in envs/.env.example (`minioadmin`, `replace-with-a-random-32-…`),
 * but helm/dharma/values.yaml ships a DIFFERENT vocabulary —
 * `nextauthSecret: "CHANGE_ME"`, `databaseUrl: "postgresql://dharma:CHANGE_ME@…"`.
 * None of it matched, so `helm install` at default values with
 * `secrets.create: true` booted happily in production with
 * NEXTAUTH_SECRET=CHANGE_ME.
 *
 * env.ts validates at module load, so each case re-imports it in isolation
 * with a fresh process env — the same jest.resetModules() approach
 * tests/scanAnomaly.test.ts uses for its module-scoped Redis client.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const ORIGINAL_ENV = { ...process.env };

/** A complete, valid production env — the baseline each case perturbs. */
function productionEnv(overrides: Record<string, string> = {}) {
  return {
    ...ORIGINAL_ENV,
    NODE_ENV: "production",
    NEXT_PHASE: "",
    DATABASE_URL: "postgresql://dharma:a-real-generated-password@db:5432/dharma?schema=public",
    REDIS_URL: "redis://:a-real-generated-password@redis:6379",
    NEXTAUTH_URL: "https://dharma.example.test",
    NEXTAUTH_SECRET: "9f2c4b8e1d7a3056f8b2c4d6e8a0b2c4",
    MINIO_ENDPOINT: "minio",
    MINIO_PORT: "9000",
    MINIO_ACCESS_KEY: "a-real-generated-access-key",
    MINIO_SECRET_KEY: "a-real-generated-secret-key",
    CONNECTOR_ENCRYPTION_KEY: "2663fe6fbfc3ad8bccefdd22386906a6",
    WEBHOOK_ENCRYPTION_KEY: "6e7ed93d9433b7ed9de17fcbace9c4c6",
    // These default to `minioadmin` in the schema, so an unset production
    // deploy is correctly refused — set them so the baseline isolates the
    // variable each case is actually testing.
    ANCHOR_STORAGE_ACCESS_KEY: "a-real-generated-anchor-access-key",
    ANCHOR_STORAGE_SECRET_KEY: "a-real-generated-anchor-secret-key",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function loadEnvModule(env: NodeJS.ProcessEnv): { error?: Error } {
  jest.resetModules();
  process.env = env;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("@/env");
    return {};
  } catch (error) {
    return { error: error as Error };
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
});

describe("production secret guard", () => {
  it("boots with real generated secrets (baseline)", () => {
    const { error } = loadEnvModule(productionEnv());
    expect(error).toBeUndefined();
  });

  it("refuses a CHANGE_ME NEXTAUTH_SECRET long enough to pass the length rule", () => {
    // NOTE: the chart's literal `nextauthSecret: "CHANGE_ME"` (9 chars) was
    // ALREADY refused, by the schema's existing min(32) rule rather than by
    // the placeholder guard — so DEV-6's headline example overstated the
    // exposure slightly. The real gap is a placeholder that satisfies the
    // length rule, which is what this pins.
    const { error } = loadEnvModule(
      productionEnv({ NEXTAUTH_SECRET: "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME" }),
    );
    expect(error?.message).toMatch(/Refusing to start in production/);
    expect(error?.message).toMatch(/NEXTAUTH_SECRET/);
  });

  it("refuses CHANGE_ME embedded in a connection URL", () => {
    // The case an exact-match deny-list cannot catch: the operator set a real
    // host and left the placeholder password.
    const { error } = loadEnvModule(
      productionEnv({
        DATABASE_URL: "postgresql://dharma:CHANGE_ME@postgres:5432/dharma_db?schema=public",
      }),
    );
    expect(error?.message).toMatch(/Refusing to start in production/);
    expect(error?.message).toMatch(/DATABASE_URL/);
  });

  it("refuses the exact chart defaults for every credential it ships", () => {
    const { error } = loadEnvModule(
      productionEnv({
        MINIO_ACCESS_KEY: "CHANGE_ME",
        MINIO_SECRET_KEY: "CHANGE_ME",
        REDIS_URL: "redis://:CHANGE_ME@redis:6379",
      }),
    );
    expect(error?.message).toMatch(/Refusing to start in production/);
    expect(error?.message).toMatch(/MINIO_ACCESS_KEY/);
    expect(error?.message).toMatch(/MINIO_SECRET_KEY/);
    expect(error?.message).toMatch(/REDIS_URL/);
  });

  it("still refuses the .env.example placeholders it always did", () => {
    const { error } = loadEnvModule(
      productionEnv({
        MINIO_ACCESS_KEY: "minioadmin",
        NEXTAUTH_SECRET: "replace-with-a-random-32-character-secret",
      }),
    );
    expect(error?.message).toMatch(/MINIO_ACCESS_KEY/);
    expect(error?.message).toMatch(/NEXTAUTH_SECRET/);
  });

  it("does not block `next build`, which legitimately has no secrets", () => {
    // The build host compiles with NODE_ENV=production and no production
    // secrets; failing there makes the image unbuildable without making the
    // deployment safer. The check still runs when the built server starts.
    const { error } = loadEnvModule(
      productionEnv({
        NEXT_PHASE: "phase-production-build",
        NEXTAUTH_SECRET: "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME",
      }),
    );
    expect(error).toBeUndefined();
  });

  it("does not block development", () => {
    const { error } = loadEnvModule(
      productionEnv({
        NODE_ENV: "development",
        NEXTAUTH_SECRET: "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME",
      }),
    );
    expect(error).toBeUndefined();
  });
});

describe("the guard actually covers what the chart ships", () => {
  it("every CHANGE_ME value in values.yaml maps to a guarded variable", () => {
    // Pins the two files together. If someone adds a new CHANGE_ME secret to
    // the chart, this fails rather than shipping an unguarded placeholder —
    // which is exactly how DEV-6 happened.
    const values = readFileSync(
      path.join(__dirname, "..", "helm", "dharma", "values.yaml"),
      "utf8",
    );

    const placeholderKeys = values
      .split("\n")
      .filter((line) => line.includes("CHANGE_ME"))
      .map((line) => line.trim().split(":")[0]);

    expect(placeholderKeys.length).toBeGreaterThan(0);

    // chart key (camelCase) -> env var the chart wires it to (secret.yaml)
    const chartKeyToEnv: Record<string, string> = {
      databaseUrl: "DATABASE_URL",
      redisUrl: "REDIS_URL",
      minioAccessKey: "MINIO_ACCESS_KEY",
      minioSecretKey: "MINIO_SECRET_KEY",
      nextauthSecret: "NEXTAUTH_SECRET",
    };

    for (const key of placeholderKeys) {
      expect(chartKeyToEnv).toHaveProperty(key);
    }
  });
});
