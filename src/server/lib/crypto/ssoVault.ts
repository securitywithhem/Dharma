// Phase 8 Part 1 — AES-256-GCM envelope for SSO secrets at rest (OIDC client
// secrets, OIDC transaction state cookies). Reuses secretVault.ts under a
// distinct key (SSO_ENCRYPTION_KEY) so a compromise of the connector or
// webhook key does not expose IdP credentials, matching the per-domain key
// convention established by webhookVault.ts.
import { encryptSecret, decryptSecret } from "./secretVault";

const SSO_ENV_VAR = "SSO_ENCRYPTION_KEY";

export function encryptSsoSecret(value: unknown): string {
  return encryptSecret(value, SSO_ENV_VAR);
}

export function decryptSsoSecret<T = string>(encrypted: string): T {
  return decryptSecret<T>(encrypted, SSO_ENV_VAR);
}
