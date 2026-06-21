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
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000")
});

export const env = envSchema.parse(process.env);

export type AppEnv = typeof env;
