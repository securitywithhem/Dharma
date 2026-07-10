// Encrypts webhook signing secrets at rest, mirroring connectorVault.ts but
// under a distinct key (WEBHOOK_ENCRYPTION_KEY) so a compromise of one
// secret class doesn't also expose the other.
import { encryptSecret, decryptSecret } from './secretVault';

const WEBHOOK_ENV_VAR = 'WEBHOOK_ENCRYPTION_KEY';

export function encryptWebhookSecret(secret: string): string {
  return encryptSecret(secret, WEBHOOK_ENV_VAR);
}

export function decryptWebhookSecret(encryptedDataStr: string): string {
  return decryptSecret<string>(encryptedDataStr, WEBHOOK_ENV_VAR);
}
