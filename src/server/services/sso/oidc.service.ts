// Phase 8 Part 1 — OIDC login via openid-client v5 (authorization-code +
// PKCE S256, discovery from the issuer URL).
//
// The per-login transaction state (code_verifier, state, nonce) is kept in
// a short-lived AES-256-GCM-encrypted httpOnly cookie (ssoVault) rather
// than server-side storage — self-authenticating, and confidentiality of
// the verifier is preserved even though PKCE only strictly needs integrity.
import { Issuer, generators, type Client } from "openid-client";
import type { PrismaClient, User } from "@prisma/client";
import { env } from "@/env";
import { encryptSsoSecret, decryptSsoSecret } from "@/server/lib/crypto/ssoVault";
import { parseStoredSsoConfig, type OidcConfig } from "./types";
import { upsertSsoUser, SsoProvisioningError } from "./userProvisioning";

export class OidcConfigError extends Error {}
export class OidcValidationError extends Error {}

export const OIDC_TX_COOKIE = "dharma-oidc-tx";
const TX_MAX_AGE_SECONDS = 10 * 60;

export function oidcCallbackUrl(organizationId: string) {
  return `${env.NEXTAUTH_URL}/api/sso/oidc/${organizationId}/callback`;
}

export type OidcTransaction = {
  organizationId: string;
  codeVerifier: string;
  state: string;
  nonce: string;
  issuedAt: number;
};

export async function discoverIssuer(issuerUrl: string): Promise<Issuer> {
  if (!issuerUrl.startsWith("https://")) {
    throw new OidcConfigError("OIDC issuer URLs must use https.");
  }
  try {
    return await Issuer.discover(issuerUrl);
  } catch (error) {
    throw new OidcConfigError(
      `OIDC discovery failed for ${issuerUrl}: ${(error as Error).message}`,
    );
  }
}

async function buildClient(
  organizationId: string,
  config: OidcConfig,
): Promise<Client> {
  const issuer = await discoverIssuer(config.issuer);
  return new issuer.Client({
    client_id: config.clientId,
    client_secret: decryptSsoSecret<string>(config.clientSecretEnc),
    redirect_uris: [oidcCallbackUrl(organizationId)],
    response_types: ["code"],
  });
}

async function loadOidcConfig(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OidcConfig> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });
  const config = parseStoredSsoConfig(settings?.ssoConfig);
  if (!config || config.type !== "OIDC") {
    throw new OidcConfigError(
      `Organization ${organizationId} has no OIDC configuration.`,
    );
  }
  return config;
}

export async function buildOidcLoginRedirect(
  prisma: PrismaClient,
  organizationId: string,
): Promise<{ authorizationUrl: string; txCookieValue: string; txMaxAge: number }> {
  const config = await loadOidcConfig(prisma, organizationId);
  const client = await buildClient(organizationId, config);

  const codeVerifier = generators.codeVerifier();
  const state = generators.state();
  const nonce = generators.nonce();

  const authorizationUrl = client.authorizationUrl({
    scope: "openid email profile",
    code_challenge: generators.codeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });

  const tx: OidcTransaction = {
    organizationId,
    codeVerifier,
    state,
    nonce,
    issuedAt: Date.now(),
  };

  return {
    authorizationUrl,
    txCookieValue: encryptSsoSecret(tx),
    txMaxAge: TX_MAX_AGE_SECONDS,
  };
}

export async function handleOidcCallback(
  prisma: PrismaClient,
  organizationId: string,
  callbackUrl: URL,
  txCookieValue: string | undefined,
  ipAddress?: string | null,
): Promise<User> {
  if (!txCookieValue) {
    throw new OidcValidationError(
      "Missing login transaction — start the login again.",
    );
  }

  let tx: OidcTransaction;
  try {
    tx = decryptSsoSecret<OidcTransaction>(txCookieValue);
  } catch {
    throw new OidcValidationError("Invalid login transaction cookie.");
  }
  if (
    tx.organizationId !== organizationId ||
    Date.now() - tx.issuedAt > TX_MAX_AGE_SECONDS * 1000
  ) {
    throw new OidcValidationError("Login transaction expired or mismatched.");
  }

  const config = await loadOidcConfig(prisma, organizationId);
  const client = await buildClient(organizationId, config);

  let claims;
  try {
    const params = client.callbackParams(callbackUrl.toString());
    const tokenSet = await client.callback(
      oidcCallbackUrl(organizationId),
      params,
      { code_verifier: tx.codeVerifier, state: tx.state, nonce: tx.nonce },
    );
    claims = tokenSet.claims();
  } catch (error) {
    throw new OidcValidationError(
      `OIDC callback validation failed: ${(error as Error).message}`,
    );
  }

  const email = typeof claims.email === "string" ? claims.email : null;
  if (!email) {
    throw new OidcValidationError(
      "The ID token carried no email claim — ensure the 'email' scope is granted.",
    );
  }

  try {
    return await upsertSsoUser({
      prisma,
      organizationId,
      email,
      name: typeof claims.name === "string" ? claims.name : null,
      provider: "oidc",
      ipAddress,
    });
  } catch (error) {
    if (error instanceof SsoProvisioningError) {
      throw new OidcValidationError(error.publicMessage);
    }
    throw error;
  }
}

/** Dry-run used by sso.testConnection — discovery only, no login. */
export async function testOidcDiscovery(issuerUrl: string) {
  const issuer = await discoverIssuer(issuerUrl);
  return {
    issuer: issuer.metadata.issuer,
    authorizationEndpoint: issuer.metadata.authorization_endpoint,
    tokenEndpoint: issuer.metadata.token_endpoint,
  };
}
