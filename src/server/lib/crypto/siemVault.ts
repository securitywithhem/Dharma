// Phase 8 Part 2 — AES-256-GCM envelope for SIEM export secrets at rest
// (Splunk HEC tokens). Own key per the established per-domain convention
// (connector / webhook / sso vaults).
import { encryptSecret, decryptSecret } from "./secretVault";

const SIEM_ENV_VAR = "SIEM_ENCRYPTION_KEY";

export function encryptSiemSecret(value: unknown): string {
  return encryptSecret(value, SIEM_ENV_VAR);
}

export function decryptSiemSecret<T = string>(encrypted: string): T {
  return decryptSecret<T>(encrypted, SIEM_ENV_VAR);
}
