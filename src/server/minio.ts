/**
 * src/server/minio.ts
 *
 * MinIO S3-compatible object storage client.
 * Handles bucket initialisation, presigned URLs, object deletion, and metadata.
 *
 * Environment variables:
 *   MINIO_ENDPOINT   – hostname or IP (default: localhost)
 *   MINIO_PORT       – port           (default: 9000)
 *   MINIO_USE_SSL    – "true" | "false" (default: false)
 *   MINIO_ACCESS_KEY – access key     (default: minioadmin)
 *   MINIO_SECRET_KEY – secret key     (default: minioadmin)
 *   MINIO_BUCKET     – bucket name    (default: dharma-evidence)
 *   MINIO_REGION     – region         (default: us-east-1)
 */

import * as Minio from "minio";

// ------------------------------------------------------------------
// Client singleton (safe for Next.js hot-reload)
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __dharmaMinioClient: Minio.Client | undefined;
}

function createMinioClient(): Minio.Client {
  return new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: parseInt(process.env.MINIO_PORT ?? "9000", 10),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
  });
}

export const minioClient: Minio.Client =
  globalThis.__dharmaMinioClient ?? createMinioClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__dharmaMinioClient = minioClient;
}

export const BUCKET_NAME = process.env.MINIO_BUCKET ?? "dharma-evidence";
const REGION = process.env.MINIO_REGION ?? "us-east-1";
const PRESIGNED_EXPIRY_SECONDS = 900; // 15 minutes

// ------------------------------------------------------------------
// Retry helper
// ------------------------------------------------------------------

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 300,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}

// ------------------------------------------------------------------
// Bucket initialisation
// ------------------------------------------------------------------

let _bucketInitialised = false;

/**
 * Ensure the evidence bucket exists.
 * Called once at server startup (or lazily on first use if startup is skipped).
 */
export async function initializeMinIOBucket(): Promise<void> {
  if (_bucketInitialised) return;

  try {
    await withRetry(async () => {
      const exists = await minioClient.bucketExists(BUCKET_NAME);
      if (!exists) {
        await minioClient.makeBucket(BUCKET_NAME, REGION);
        console.log(`✅ MinIO: Created bucket "${BUCKET_NAME}" in region "${REGION}"`);

        // Apply a lifecycle policy to auto-expire temporary uploads after 7 days
        // This acts as a safety net for any orphaned presigned-URL uploads.
        const lifecycleConfig = {
          Rule: [
            {
              ID: "expire-incomplete-uploads",
              Status: "Enabled",
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
            },
          ],
        };

        try {
          await minioClient.setBucketLifecycle(BUCKET_NAME, lifecycleConfig);
        } catch {
          // Non-fatal: lifecycle rules may not be supported on all MinIO versions
        }
      } else {
        console.log(`✅ MinIO: Bucket "${BUCKET_NAME}" already exists`);
      }
    });

    _bucketInitialised = true;
  } catch (error) {
    console.error("❌ MinIO bucket initialisation failed:", error);
    // Don't throw — the app can still run; uploads will fail gracefully
  }
}

// ------------------------------------------------------------------
// Presigned URLs
// ------------------------------------------------------------------

/**
 * Presigned URLs are signed against the INTERNAL endpoint (e.g. minio:9000
 * inside compose/k8s), which browsers cannot resolve. Rewrite host/port to
 * MINIO_PUBLIC_URL for anything handed to a client — same pattern as
 * src/lib/storage/minioClient.ts. No-op when the var is unset (bare-host dev).
 */
function toPublicUrl(presignedUrl: string): string {
  if (!process.env.MINIO_PUBLIC_URL) return presignedUrl;
  const url = new URL(presignedUrl);
  const publicUrl = new URL(process.env.MINIO_PUBLIC_URL);
  url.protocol = publicUrl.protocol;
  url.host = publicUrl.host;
  url.port = publicUrl.port || "";
  return url.toString();
}

/**
 * Generate a presigned PUT URL for direct browser → MinIO uploads.
 * The caller should PUT the file body directly to this URL.
 */
export async function generatePresignedUploadUrl(
  objectName: string,
  expirySeconds = PRESIGNED_EXPIRY_SECONDS,
): Promise<string> {
  const url = await withRetry(() =>
    minioClient.presignedPutObject(BUCKET_NAME, objectName, expirySeconds),
  );
  return toPublicUrl(url);
}

/**
 * Generate a presigned GET URL for authenticated file downloads.
 */
export async function generatePresignedDownloadUrl(
  objectName: string,
  expirySeconds = PRESIGNED_EXPIRY_SECONDS,
): Promise<string> {
  const url = await withRetry(() =>
    minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds),
  );
  return toPublicUrl(url);
}

// ------------------------------------------------------------------
// Object operations
// ------------------------------------------------------------------

/**
 * Upload raw content (e.g. a scan log) directly to the evidence bucket.
 * Unlike `generatePresignedUploadUrl`, this writes server-side — used by
 * background workers that already hold the data in memory.
 */
export async function putObject(
  objectName: string,
  content: string | Buffer,
  contentType = "application/octet-stream",
): Promise<void> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8");
  await withRetry(() =>
    minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, {
      "Content-Type": contentType,
    }),
  );
}

/**
 * Delete an object from the evidence bucket.
 */
export async function deleteObject(objectName: string): Promise<void> {
  await withRetry(() =>
    minioClient.removeObject(BUCKET_NAME, objectName),
  );
  console.log(`🗑️  MinIO: Deleted object "${objectName}"`);
}

/**
 * Retrieve object metadata (size, content-type, last-modified, etag).
 */
export async function getObjectMetadata(
  objectName: string,
): Promise<Minio.BucketItemStat> {
  return withRetry(() =>
    minioClient.statObject(BUCKET_NAME, objectName),
  );
}

// ------------------------------------------------------------------
// Storage key helpers
// ------------------------------------------------------------------

/**
 * Build a deterministic storage key for an uploaded evidence file.
 * Format: <orgId>/<controlId>/<timestamp>-<uuid>.<ext>
 */
export function buildStorageKey(
  organizationId: string,
  controlId: string,
  fileName: string,
  uniqueId: string,
): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "bin";
  const timestamp = Date.now();
  return `${organizationId}/${controlId}/${timestamp}-${uniqueId}.${ext}`;
}
