/**
 * src/server/anchorMinio.ts
 *
 * Phase 2 Feature 3 — A dedicated MinIO/S3 client for the WORM anchor bucket.
 * This is intentionally SEPARATE from src/server/minio.ts (evidence bucket) to
 * enforce the principle that anchor data and evidence data never share a bucket.
 *
 * Production note:
 *   ANCHOR_STORAGE_* env vars should point to a real AWS S3 bucket configured
 *   with Object Lock in COMPLIANCE mode and a multi-year retention policy.
 *   The local MinIO fallback (dev default) does NOT enforce WORM — it will log
 *   a warning on every write so operators are aware.
 *
 * [skills: backend-dev-guidelines, container-security-hardening]
 */

import * as Minio from "minio";
import { env } from "@/env";

// ------------------------------------------------------------------
// Client singleton
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __dharmaAnchorMinioClient: Minio.Client | undefined;
}

function createAnchorClient(): Minio.Client {
  return new Minio.Client({
    endPoint: env.ANCHOR_STORAGE_ENDPOINT,
    port: env.ANCHOR_STORAGE_PORT,
    useSSL: env.ANCHOR_STORAGE_USE_SSL,
    accessKey: env.ANCHOR_STORAGE_ACCESS_KEY,
    secretKey: env.ANCHOR_STORAGE_SECRET_KEY,
  });
}

export const anchorMinioClient: Minio.Client =
  globalThis.__dharmaAnchorMinioClient ?? createAnchorClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__dharmaAnchorMinioClient = anchorMinioClient;
}

const IS_PRODUCTION_WORM =
  env.ANCHOR_STORAGE_ENDPOINT !== "localhost" &&
  env.ANCHOR_STORAGE_ENDPOINT !== "minio";

// ------------------------------------------------------------------
// Bucket initialisation
// ------------------------------------------------------------------

let _anchorBucketInitialised = false;

export async function initAnchorBucket(): Promise<void> {
  if (_anchorBucketInitialised) return;

  if (!IS_PRODUCTION_WORM) {
    console.warn(
      "⚠️  [anchor] WORM storage is pointing at local MinIO. " +
        "Object Lock is NOT enforced. " +
        "Set ANCHOR_STORAGE_* to a production S3 bucket with Object Lock before going live.",
    );
  }

  const exists = await anchorMinioClient.bucketExists(env.ANCHOR_STORAGE_BUCKET);
  if (!exists) {
    await anchorMinioClient.makeBucket(env.ANCHOR_STORAGE_BUCKET, "us-east-1");
    console.log(`✅ [anchor] Created anchor bucket "${env.ANCHOR_STORAGE_BUCKET}"`);
  } else {
    console.log(`✅ [anchor] Anchor bucket "${env.ANCHOR_STORAGE_BUCKET}" already exists`);
  }

  _anchorBucketInitialised = true;
}

// ------------------------------------------------------------------
// Object operations
// ------------------------------------------------------------------

/**
 * Write an anchor manifest to the WORM bucket.
 * In production this call should include ObjectLockMode + ObjectLockRetainUntilDate
 * headers — the S3 SDK will enforce WORM at the server side.
 */
export async function putAnchorObject(
  key: string,
  body: string,
): Promise<void> {
  await initAnchorBucket();
  const buf = Buffer.from(body, "utf-8");
  await anchorMinioClient.putObject(env.ANCHOR_STORAGE_BUCKET, key, buf, buf.length, {
    "Content-Type": "application/json",
    // These headers are forwarded to S3 Object Lock when using a real AWS endpoint.
    // MinIO Community ignores them; MinIO Enterprise / AWS S3 enforces them.
    "x-amz-object-lock-mode": env.ANCHOR_STORAGE_OBJECT_LOCK_MODE,
    "x-amz-object-lock-retain-until-date": new Date(
      Date.now() + env.ANCHOR_STORAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
  console.log(`✅ [anchor] Written anchor object: ${key}`);
}

/**
 * Read an anchor manifest from the WORM bucket for verification.
 * The round-trip to the remote bucket (not just the DB) is the key
 * assurance: if an attacker dropped the Postgres row they cannot also
 * silently drop the WORM-protected object.
 */
export async function getAnchorObject(key: string): Promise<string> {
  const stream = await anchorMinioClient.getObject(env.ANCHOR_STORAGE_BUCKET, key);
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}
