import crypto from 'crypto';
import { generatePresignedDownloadUrl } from '@/server/minio';
import { minioClient } from '@/server/minio';

const BUCKET_NAME = process.env.MINIO_BUCKET_NAME || 'dharma-evidence';

/**
 * Sign a PDF buffer with HMAC-SHA256.
 * Returns the signed PDF with embedded signature metadata.
 *
 * Note: This is a simplified HMAC-based signature for tamper-detection.
 * For cryptographically-verifiable signatures, use X.509 certificates (node-forge).
 */
export async function signPdf(
  pdfBuffer: Buffer,
  organizationId: string,
  signingKey: string = process.env.PDF_SIGNING_KEY || 'dharma-default-key'
): Promise<{
  signedBuffer: Buffer;
  signature: string;
  timestamp: string;
}> {
  const timestamp = new Date().toISOString();

  // Compute HMAC-SHA256 signature
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(pdfBuffer);
  const signature = hmac.digest('hex');

  // Create metadata block (appended as a comment in PDF)
  const metadata = {
    organizationId,
    signature,
    timestamp,
    signedBy: 'Dharma Compliance System',
  };

  // Create signed buffer with metadata embedded
  // Note: Real PDF signing should use PDF signature dictionaries, not simple appends
  const metadataJson = JSON.stringify(metadata);
  const signedBuffer = Buffer.concat([
    pdfBuffer,
    Buffer.from(`\n%%EOF\n%Dharma-Signature: ${metadataJson}`),
  ]);

  return {
    signedBuffer,
    signature,
    timestamp,
  };
}

/**
 * Upload signed PDF to MinIO and return presigned download URL.
 */
export async function uploadSignedPdf(
  pdfBuffer: Buffer,
  organizationId: string,
  fileName: string
): Promise<string> {
  const objectKey = `reports/${organizationId}/${fileName}`;

  try {
    await minioClient.putObject(
      BUCKET_NAME,
      objectKey,
      pdfBuffer,
      pdfBuffer.length,
      {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-cache',
      }
    );

    console.log(`✅ Signed PDF uploaded to MinIO: ${objectKey}`);

    // Generate presigned download URL (valid for 7 days)
    const downloadUrl = await generatePresignedDownloadUrl(objectKey);

    return downloadUrl;
  } catch (error) {
    console.error('❌ Error uploading signed PDF:', error);
    throw error;
  }
}

/**
 * Verify PDF signature (simplified HMAC verification).
 */
export function verifyPdfSignature(
  pdfBuffer: Buffer,
  signature: string,
  signingKey: string = process.env.PDF_SIGNING_KEY || 'dharma-default-key'
): boolean {
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(pdfBuffer);
  const computedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}
