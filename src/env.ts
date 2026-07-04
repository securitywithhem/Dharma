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
});

export const env = envSchema.parse(process.env);

export type AppEnv = typeof env;
