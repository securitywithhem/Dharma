import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';

// Initialize MinIO client with internal Docker hostname
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT?.replace('http://', '').replace('https://', '') || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin_change_me',
  region: process.env.MINIO_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.MINIO_BUCKET || 'dharma-evidence';
const PRESIGNED_URL_EXPIRY = 15 * 60; // 15 minutes in seconds

/**
 * Initialize bucket on application startup.
 * Creates the bucket if it does not exist.
 */
export async function initializeBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, process.env.MINIO_REGION || 'us-east-1');
      console.log(`✅ MinIO bucket "${BUCKET_NAME}" created.`);
    } else {
      console.log(`✅ MinIO bucket "${BUCKET_NAME}" already exists.`);
    }
  } catch (error) {
    console.error('❌ Error initializing MinIO bucket:', error);
    throw error;
  }
}

/**
 * Generate a presigned upload URL for direct client-to-MinIO uploads.
 * @param fileName - Name of the file to upload
 * @param contentType - MIME type of the file (e.g., "image/png")
 * @returns Object with uploadUrl and objectKey
 */
export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string
): Promise<{ uploadUrl: string; objectKey: string }> {
  try {
    // Generate a unique object key to prevent name collisions
    const objectKey = `${uuidv4()}-${fileName}`;

    // Generate presigned PUT URL
    const uploadUrl = await minioClient.presignedPutObject(
      BUCKET_NAME,
      objectKey,
      PRESIGNED_URL_EXPIRY
    );

    // Replace internal Docker hostname with public-facing URL for client-side use
    const urlObj = new URL(uploadUrl);
    const publicUrlObj = new URL(process.env.MINIO_PUBLIC_URL || 'http://localhost:9000');
    urlObj.protocol = publicUrlObj.protocol;
    urlObj.host = publicUrlObj.host;
    urlObj.port = publicUrlObj.port || ''; // prevent trailing colon if no port
    const publicUrl = urlObj.toString();

    return {
      uploadUrl: publicUrl,
      objectKey,
    };
  } catch (error) {
    console.error('❌ Error generating presigned upload URL:', error);
    throw error;
  }
}

/**
 * Generate a presigned download URL for retrieving files from MinIO.
 * @param objectKey - The MinIO object key (file path)
 * @param expirySeconds - URL expiration time in seconds (default 1 hour)
 * @returns Presigned GET URL
 */
export async function generatePresignedDownloadUrl(
  objectKey: string,
  expirySeconds: number = 3600
): Promise<string> {
  try {
    const downloadUrl = await minioClient.presignedGetObject(
      BUCKET_NAME,
      objectKey,
      expirySeconds
    );

    // Replace internal hostname with public URL
    const urlObj = new URL(downloadUrl);
    const publicUrlObj = new URL(process.env.MINIO_PUBLIC_URL || 'http://localhost:9000');
    urlObj.protocol = publicUrlObj.protocol;
    urlObj.host = publicUrlObj.host;
    urlObj.port = publicUrlObj.port || ''; // prevent trailing colon if no port
    const publicUrl = urlObj.toString();

    return publicUrl;
  } catch (error) {
    console.error('❌ Error generating presigned download URL:', error);
    throw error;
  }
}

/**
 * Upload a file directly via stream (used for server-side uploads).
 * @param objectKey - The MinIO object key
 * @param filePath - Local file path or stream
 * @param size - File size in bytes
 * @param contentType - MIME type
 */
export async function uploadFile(
  objectKey: string,
  filePath: string | NodeJS.ReadableStream,
  size: number,
  contentType: string
): Promise<void> {
  try {
    await minioClient.fPutObject(BUCKET_NAME, objectKey, filePath as string, {
      'Content-Type': contentType,
    });
    console.log(`✅ File uploaded to MinIO: ${objectKey}`);
  } catch (error) {
    console.error('❌ Error uploading file to MinIO:', error);
    throw error;
  }
}

/**
 * Delete a file from MinIO storage.
 * @param objectKey - The MinIO object key
 */
export async function deleteFile(objectKey: string): Promise<void> {
  try {
    await minioClient.removeObject(BUCKET_NAME, objectKey);
    console.log(`✅ File deleted from MinIO: ${objectKey}`);
  } catch (error) {
    console.error('❌ Error deleting file from MinIO:', error);
    throw error;
  }
}

export default minioClient;
