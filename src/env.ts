import { z } from "zod";

// Centralized server-side environment validation keeps runtime failures explicit.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default(
      "postgresql://dharma:dharma_secure_password_change_me@localhost:5432/dharma_db?schema=public",
    ),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z
    .string()
    .min(32)
    .default("replace-with-a-random-32-character-secret"),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  EMAIL_SERVER_HOST: z.string().optional().default(""),
  EMAIL_SERVER_PORT: z.coerce.number().optional().default(587),
  EMAIL_SERVER_USER: z.string().optional().default(""),
  EMAIL_SERVER_PASSWORD: z.string().optional().default(""),
  EMAIL_FROM: z.string().email().optional().default("noreply@dharma.local"),
  MINIO_ENDPOINT: z.string().min(1).default("localhost"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  MINIO_SECRET_KEY: z.string().min(1).default("minioadmin_change_me"),
  MINIO_BUCKET: z.string().min(1).default("dharma-evidence"),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((value) => value === "true"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // ── Phase 2 Feature 3: External Audit Chain Anchoring ──────────────────
  // In production, point these at a real S3 bucket with Object Lock (WORM).
  // In dev, falls back to the local MinIO instance with a dev-only warning.
  ANCHOR_STORAGE_ENDPOINT: z.string().default("localhost"),
  ANCHOR_STORAGE_PORT: z.coerce.number().int().positive().default(9000),
  ANCHOR_STORAGE_USE_SSL: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ANCHOR_STORAGE_ACCESS_KEY: z.string().default("minioadmin"),
  ANCHOR_STORAGE_SECRET_KEY: z.string().default("minioadmin_change_me"),
  ANCHOR_STORAGE_BUCKET: z.string().default("dharma-anchor"),
  ANCHOR_STORAGE_OBJECT_LOCK_MODE: z.string().default("COMPLIANCE"),
  ANCHOR_STORAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(2555),
  PUBLIC_ANCHOR_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ANCHOR_INTERVAL_CRON: z.string().default("0 */6 * * *"),

  // ── Phase 2 Feature 2: Connector Credential Encryption ─────────────────
  // Must be exactly 32 characters (256 bits). Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex').slice(0,32))"
  CONNECTOR_ENCRYPTION_KEY: z.string().min(32).default("change-me-32-char-key-for-connectors"),
  CONNECTOR_SYNC_CRON: z.string().default("0 */12 * * *"),

  // ── Phase 4 Part 3: Webhook Secret Encryption ───────────────────────────
  // Must be a distinct key from CONNECTOR_ENCRYPTION_KEY so a compromise of
  // one secret class doesn't also expose the other. Same 64-hex-char format.
  WEBHOOK_ENCRYPTION_KEY: z.string().min(32).default("change-me-32-char-key-for-webhooks"),
  WEBHOOK_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // ── Phase 8 Part 1: SSO Secret Encryption ───────────────────────────────
  // AES-256-GCM key for OIDC client secrets and OIDC login-transaction
  // cookies (src/server/lib/crypto/ssoVault.ts). Distinct from the connector
  // and webhook keys, same 64-hex-char format. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  SSO_ENCRYPTION_KEY: z.string().length(64).optional(),

  // ── Phase 8 Part 2: Audit pipeline & SIEM export ────────────────────────
  // AUDIT_WRITER_MODE=sync forces synchronous audit writes (tests; also a
  // valid single-process deployment mode). Default: async via BullMQ.
  AUDIT_WRITER_MODE: z.enum(["async", "sync"]).optional(),
  SIEM_ENCRYPTION_KEY: z.string().length(64).optional(),

  // ── Phase 5 Part 1: Pentest Scan Engine ─────────────────────────────────
  // Local tag built from docker/pentest-scanner/Dockerfile (pinned nuclei
  // digest lives in that Dockerfile, not here — this just names the image
  // `docker run` should launch).
  NUCLEI_SCANNER_IMAGE: z.string().min(1).default("dharma-pentest-scanner:local"),
  PENTEST_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  PENTEST_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // ── WAVE 12: Strix scan engine ──────────────────────────────────────────
  // Name of the long-lived container built from docker/strix/Dockerfile. The
  // worker `docker exec`s into it rather than `docker run`-ing a fresh image
  // per scan, because Strix pulls its own multi-hundred-MB sandbox image on
  // first use — paying that once at compose-up is the difference between a
  // scan starting in seconds and a scan appearing to hang on its first run.
  STRIX_CONTAINER_NAME: z.string().min(1).default("dharma-strix"),
  // Sandbox image Strix launches per agent. Pinned, not :latest — an
  // autonomous exploitation agent is the last component that should silently
  // change version under a running deployment. Keep in step with
  // docker/strix/Dockerfile's pre-pull.
  STRIX_SANDBOX_IMAGE: z.string().min(1).default("ghcr.io/usestrix/strix-sandbox:1.3.0"),
  // Path INSIDE both the strix and pentest-worker containers where the shared
  // `strix_runs` volume is mounted. The worker reads run artifacts straight
  // off this volume rather than shelling out to `strix view`.
  STRIX_RUNS_DIR: z.string().min(1).default("/strix-runs"),
  // Deliberately NOT PENTEST_SCAN_TIMEOUT_MS. See strixScanQueue.ts for why an
  // agentic scan needs its own budget rather than inheriting nuclei's.
  STRIX_SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(7_200_000),
  // Strix is an LLM agent: with no model configured it cannot scan at all.
  // Optional here so the rest of the platform boots without it — engines.status
  // reports STRIX unavailable instead, and the UI disables the option.
  STRIX_LLM: z.string().min(1).optional(),
});

// ── Production placeholder guard ────────────────────────────────────────────
// Every secret above keeps a development default so `npm run dev` and the test
// suite work with no env file. That convenience is a production footgun: a
// deploy that forgets to set NEXTAUTH_SECRET or MINIO_SECRET_KEY would boot
// happily on a publicly-known value rather than failing. docker-compose.yml
// already refuses to start on unset secrets (`${VAR:?...}`); this is the same
// discipline enforced in-process, for deploys that don't go through compose
// (k8s/helm, `next start` on a host, CI images).
//
// Deliberately a deny-list of the exact shipped defaults rather than "reject
// anything short": operators may legitimately choose a value we'd otherwise
// consider weak, but nobody legitimately chooses the string we published.
const INSECURE_DEFAULTS: Record<string, readonly string[]> = {
  DATABASE_URL: [
    "postgresql://dharma:dharma_secure_password_change_me@localhost:5432/dharma_db?schema=public",
  ],
  NEXTAUTH_SECRET: ["replace-with-a-random-32-character-secret"],
  MINIO_ACCESS_KEY: ["minioadmin"],
  MINIO_SECRET_KEY: ["minioadmin", "minioadmin_change_me"],
  ANCHOR_STORAGE_ACCESS_KEY: ["minioadmin"],
  ANCHOR_STORAGE_SECRET_KEY: ["minioadmin", "minioadmin_change_me"],
  CONNECTOR_ENCRYPTION_KEY: ["change-me-32-char-key-for-connectors"],
  WEBHOOK_ENCRYPTION_KEY: ["change-me-32-char-key-for-webhooks"],
};

// WAVE 10.5 (fullstack-audit-2026-08-06 DEV-6) — the Helm chart's placeholder
// vocabulary.
//
// The deny-list above covers the exact strings shipped in envs/.env.example.
// helm/dharma/values.yaml ships a DIFFERENT set: `nextauthSecret: "CHANGE_ME"`,
// `databaseUrl: "postgresql://dharma:CHANGE_ME@postgres:5432/…"`. None of them
// matched, so `helm install` at default values with `secrets.create: true`
// booted happily in production with NEXTAUTH_SECRET=CHANGE_ME. CI's own path
// was already safe (staging/production set `secrets.create: false` and CI
// preflights the Secret) — this closes the manual-install path.
//
// A SUBSTRING check, unlike everything above, and deliberately so: CHANGE_ME
// appears embedded in a connection URL, so an exact match would miss an
// operator who set a real host and left the placeholder password. The
// exact-match discipline exists so we never reject a value an operator
// legitimately chose — and "CHANGE_ME" is a token we publish precisely to be
// replaced, so nobody legitimately chooses it inside a secret.
const PLACEHOLDER_TOKENS = ["CHANGE_ME"] as const;

const PLACEHOLDER_SCANNED_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "ANCHOR_STORAGE_ACCESS_KEY",
  "ANCHOR_STORAGE_SECRET_KEY",
  "CONNECTOR_ENCRYPTION_KEY",
  "WEBHOOK_ENCRYPTION_KEY",
] as const;

function assertNoInsecureDefaults(parsed: Record<string, unknown>): void {
  if (parsed.NODE_ENV !== "production") return;

  // `next build` evaluates route modules to collect page data, with NODE_ENV
  // already set to "production". That is a COMPILE, not a boot: the build host
  // legitimately has no production secrets, and failing here makes the image
  // unbuildable rather than making the deployment safer. The check that
  // actually matters still runs when the built server starts, where the
  // secrets are real and a placeholder is a genuine incident.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const exactOffenders = Object.entries(INSECURE_DEFAULTS)
    .filter(([key, bad]) => bad.includes(String(parsed[key] ?? "")))
    .map(([key]) => key);

  const placeholderOffenders = PLACEHOLDER_SCANNED_KEYS.filter((key) => {
    const value = String(parsed[key] ?? "");
    return value !== "" && PLACEHOLDER_TOKENS.some((token) => value.includes(token));
  });

  const offenders = Array.from(new Set([...exactOffenders, ...placeholderOffenders]));

  if (offenders.length > 0) {
    throw new Error(
      `Refusing to start in production with shipped placeholder secrets: ` +
        `${offenders.join(", ")}. Set each to a unique generated value ` +
        `(see envs/.env.example) before deploying.`,
    );
  }
}

const parsedEnv = envSchema.parse(process.env);
assertNoInsecureDefaults(parsedEnv as unknown as Record<string, unknown>);

export const env = parsedEnv;

export type AppEnv = typeof env;
