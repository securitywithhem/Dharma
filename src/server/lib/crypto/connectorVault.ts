// substituting secrets-management skill conventions
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY is not set in environment variables');
  }
  
  if (secret.length !== 64) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  
  return Buffer.from(secret, 'hex');
}

/**
 * Encrypts a JSON payload (or any string) using AES-256-GCM.
 * Returns a base64 encoded string format: iv:tag:encryptedData
 */
export function encryptConnectorConfig(config: any): string {
  const text = JSON.stringify(config);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const tag = cipher.getAuthTag();
  
  // Format: iv(base64):tag(base64):encryptedData
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypts a payload that was encrypted by encryptConnectorConfig.
 */
export function decryptConnectorConfig<T = any>(encryptedDataStr: string): T {
  const parts = encryptedDataStr.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format. Expected iv:tag:data');
  }
  
  const [ivBase64, tagBase64, encryptedText] = parts;
  
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const key = getEncryptionKey();
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted) as T;
}
