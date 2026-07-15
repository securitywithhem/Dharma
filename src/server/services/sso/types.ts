// Phase 8 Part 1 — shapes stored in OrganizationSettings.ssoConfig.
// Secret members are always AES-256-GCM envelopes (ssoVault), never
// plaintext; sso.getConfig additionally redacts them on read.
import { z } from "zod";

export const samlConfigSchema = z.object({
  type: z.literal("SAML"),
  /** IdP entityID from metadata. */
  entityId: z.string().min(1),
  /** IdP SSO endpoint (HTTP-Redirect binding preferred, POST accepted). */
  ssoUrl: z.string().url(),
  /** IdP X.509 signing certificate, PEM or raw base64 body. Public key — not a secret. */
  certificate: z.string().min(64),
  /** Where the metadata came from, for display/re-sync. */
  metadataUrl: z.string().url().optional(),
});

export const oidcConfigSchema = z.object({
  type: z.literal("OIDC"),
  /** Issuer URL used for OIDC discovery (.well-known/openid-configuration). */
  issuer: z.string().url(),
  clientId: z.string().min(1),
  /** AES-256-GCM envelope of the client secret (ssoVault). */
  clientSecretEnc: z.string().min(1),
});

export const ssoConfigSchema = z.discriminatedUnion("type", [
  samlConfigSchema,
  oidcConfigSchema,
]);

export type SamlConfig = z.infer<typeof samlConfigSchema>;
export type OidcConfig = z.infer<typeof oidcConfigSchema>;
export type SsoConfig = z.infer<typeof ssoConfigSchema>;

/** Parses OrganizationSettings.ssoConfig, returning null when unset/invalid. */
export function parseStoredSsoConfig(value: unknown): SsoConfig | null {
  const parsed = ssoConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
