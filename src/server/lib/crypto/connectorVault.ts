// Thin wrapper around secretVault.ts, kept as its own module so callers
// (registry, routers, workers) don't need to know the encryption env var
// name — connector configs and webhook secrets are encrypted under
// different keys even though they share the same AES-256-GCM envelope.
import { encryptSecret, decryptSecret } from './secretVault';

const CONNECTOR_ENV_VAR = 'CONNECTOR_ENCRYPTION_KEY';

/**
 * Encrypts a JSON payload (or any string) using AES-256-GCM.
 * Returns a base64 encoded string format: iv:tag:encryptedData
 */
export function encryptConnectorConfig(config: any): string {
  return encryptSecret(config, CONNECTOR_ENV_VAR);
}

/**
 * Decrypts a payload that was encrypted by encryptConnectorConfig.
 */
export function decryptConnectorConfig<T = any>(encryptedDataStr: string): T {
  return decryptSecret<T>(encryptedDataStr, CONNECTOR_ENV_VAR);
}
