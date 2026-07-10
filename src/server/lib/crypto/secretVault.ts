// Generic AES-256-GCM envelope for any server-side secret at rest
// (connector configs, webhook signing secrets, ...). Extracted from
// connectorVault.ts in Phase 4 Part 3 so webhook secrets reuse the exact
// same encryption behavior instead of a parallel implementation.
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

function getEncryptionKey(envVar: string): Buffer {
  const secret = process.env[envVar];
  if (!secret) {
    throw new Error(`${envVar} is not set in environment variables`);
  }

  if (secret.length !== 64) {
    throw new Error(`${envVar} must be a 64-character hex string (32 bytes)`);
  }

  return Buffer.from(secret, 'hex');
}

/**
 * Encrypts a JSON-serializable value using AES-256-GCM.
 * Returns a base64 encoded string format: iv:tag:encryptedData
 */
export function encryptSecret(value: any, envVar: string): string {
  const text = JSON.stringify(value);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey(envVar);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypts a payload that was encrypted by encryptSecret.
 */
export function decryptSecret<T = any>(encryptedDataStr: string, envVar: string): T {
  const parts = encryptedDataStr.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format. Expected iv:tag:data');
  }

  const [ivBase64, tagBase64, encryptedText] = parts;

  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const key = getEncryptionKey(envVar);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as T;
}
