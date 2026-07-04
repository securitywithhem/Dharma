/**
 * src/lib/crypto/credentials.ts
 *
 * Phase 2 Feature 2 — AES-256-GCM symmetric encryption for connector
 * credentials (GitHub PATs, AWS keys, Vercel tokens).
 *
 * Key: CONNECTOR_ENCRYPTION_KEY env var (must be exactly 32 chars = 256 bits).
 * Format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>" — all in a single string.
 *
 * SECURITY: The key stays on the self-hosted server (data sovereignty maintained).
 * Credentials are NEVER returned in tRPC responses — only their presence is indicated.
 *
 * [skills: backend-dev-guidelines, sast-configuration]
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = env.CONNECTOR_ENCRYPTION_KEY;
  if (key.length < 32) {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY must be at least 32 characters. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  // Use exactly the first 32 bytes — pad or slice the raw UTF-8 bytes
  return Buffer.from(key, "utf-8").subarray(0, 32);
}

/**
 * Encrypts a plaintext credential string using AES-256-GCM.
 * Returns a string safe to store in the database.
 */
export function encryptCredential(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a credential string produced by encryptCredential().
 * Returns the original plaintext.
 */
export function decryptCredential(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("[credentials] Invalid ciphertext format — expected iv:authTag:data");
  }

  const key = getKey();
  const iv = Buffer.from(parts[0]!, "hex");
  const authTag = Buffer.from(parts[1]!, "hex");
  const encrypted = Buffer.from(parts[2]!, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted).toString("utf-8") + decipher.final("utf-8");
}
