// Phase 8 Part 1 — SAML 2.0 SP implementation on @node-saml/node-saml.
//
// Security posture (TRD "Security-first"):
// - Signatures are always required: wantAssertionsSigned + audience checks
//   are on, and node-saml validates the response signature against the IdP
//   cert pinned in the org's stored config — never a cert carried inside
//   the SAMLResponse itself.
// - Replay/expiry: node-saml enforces NotBefore/NotOnOrAfter with a small
//   clock skew and a bounded assertion age.
// - Per-org isolation: every SAML object is constructed from ONE org's
//   stored config; the ACS/metadata URLs embed the orgId so a response for
//   org A can never validate under org B's cert (covered by tests).
import { SAML } from "@node-saml/node-saml";
import { XMLParser } from "fast-xml-parser";
import type { PrismaClient, User } from "@prisma/client";
import { env } from "@/env";
import {
  parseStoredSsoConfig,
  samlConfigSchema,
  type SamlConfig,
} from "./types";
import { upsertSsoUser, SsoProvisioningError } from "./userProvisioning";

export class SamlConfigError extends Error {}
export class SamlValidationError extends Error {}

export function samlCallbackUrl(organizationId: string) {
  return `${env.NEXTAUTH_URL}/api/sso/saml/${organizationId}/callback`;
}

/** SP entityID — also where the IdP can fetch our metadata. */
export function samlSpEntityId(organizationId: string) {
  return `${env.NEXTAUTH_URL}/api/sso/saml/${organizationId}/metadata`;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function firstDeep(node: unknown, path: string[]): unknown {
  let current: unknown = node;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    let next = (current as Record<string, unknown>)[key];
    if (Array.isArray(next)) next = next[0];
    current = next;
  }
  return current;
}

/**
 * Parses IdP metadata XML into the fields we persist. Throws SamlConfigError
 * with an admin-readable message when required elements are missing.
 */
export function parseIdpMetadata(metadataXml: string): {
  entityId: string;
  ssoUrl: string;
  certificate: string;
} {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(metadataXml);
  } catch {
    throw new SamlConfigError("Metadata is not well-formed XML.");
  }

  const descriptor =
    (firstDeep(doc, ["EntityDescriptor"]) as Record<string, unknown>) ??
    (firstDeep(doc, ["EntitiesDescriptor", "EntityDescriptor"]) as
      | Record<string, unknown>
      | undefined);
  if (!descriptor) {
    throw new SamlConfigError("Metadata has no <EntityDescriptor>.");
  }

  const entityId = descriptor["@_entityID"];
  if (typeof entityId !== "string" || entityId.length === 0) {
    throw new SamlConfigError("Metadata is missing the entityID attribute.");
  }

  const idpDescriptor = firstDeep(descriptor, ["IDPSSODescriptor"]);
  if (!idpDescriptor) {
    throw new SamlConfigError(
      "Metadata has no <IDPSSODescriptor> — is this SP metadata instead of IdP metadata?",
    );
  }

  const ssoServices = (idpDescriptor as Record<string, unknown>)[
    "SingleSignOnService"
  ];
  const ssoList = Array.isArray(ssoServices)
    ? ssoServices
    : ssoServices
      ? [ssoServices]
      : [];
  const redirectBinding = ssoList.find((s) =>
    String(s?.["@_Binding"] ?? "").includes("HTTP-Redirect"),
  );
  const chosen = redirectBinding ?? ssoList[0];
  const ssoUrl = chosen?.["@_Location"];
  if (typeof ssoUrl !== "string" || !ssoUrl.startsWith("http")) {
    throw new SamlConfigError(
      "Metadata has no usable <SingleSignOnService> Location.",
    );
  }

  // Prefer the signing KeyDescriptor; some IdPs mark none, in which case any
  // X509Certificate present is the signing cert.
  const keyDescriptors = (idpDescriptor as Record<string, unknown>)[
    "KeyDescriptor"
  ];
  const keyList = Array.isArray(keyDescriptors)
    ? keyDescriptors
    : keyDescriptors
      ? [keyDescriptors]
      : [];
  const signingKey =
    keyList.find((k) => k?.["@_use"] === "signing") ??
    keyList.find((k) => !k?.["@_use"]) ??
    keyList[0];
  const certificate = firstDeep(signingKey, [
    "KeyInfo",
    "X509Data",
    "X509Certificate",
  ]);
  const certText =
    typeof certificate === "string"
      ? certificate
      : typeof certificate === "object" && certificate !== null
        ? String((certificate as Record<string, unknown>)["#text"] ?? "")
        : "";
  const normalizedCert = certText.replace(/\s+/g, "");
  if (normalizedCert.length < 64) {
    throw new SamlConfigError(
      "Metadata has no X.509 signing certificate — signature validation would be impossible.",
    );
  }

  return { entityId, ssoUrl, certificate: normalizedCert };
}

/**
 * Accepts either raw metadata XML or an https metadata URL, returns a
 * validated SamlConfig. URL fetches are restricted to https to avoid
 * trusting cleartext-delivered certificates.
 */
export async function validateMetadata(
  metadataXmlOrUrl: string,
): Promise<SamlConfig> {
  let xml = metadataXmlOrUrl.trim();
  let metadataUrl: string | undefined;

  if (xml.startsWith("http://")) {
    throw new SamlConfigError(
      "Metadata URLs must use https — a cleartext-fetched certificate cannot be trusted.",
    );
  }
  if (xml.startsWith("https://")) {
    metadataUrl = xml;
    const response = await fetch(metadataUrl, {
      headers: { accept: "application/samlmetadata+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new SamlConfigError(
        `Metadata URL returned HTTP ${response.status}.`,
      );
    }
    xml = await response.text();
  }

  const parsed = parseIdpMetadata(xml);
  return samlConfigSchema.parse({
    type: "SAML",
    ...parsed,
    metadataUrl,
  });
}

/** Configured node-saml instance for one org. */
export function buildSamlStrategy(
  organizationId: string,
  config: SamlConfig,
): SAML {
  return new SAML({
    callbackUrl: samlCallbackUrl(organizationId),
    entryPoint: config.ssoUrl,
    issuer: samlSpEntityId(organizationId),
    idpCert: config.certificate,
    audience: samlSpEntityId(organizationId),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 5_000,
    // Reject assertions issued more than 5 minutes ago even if their own
    // NotOnOrAfter is generous — bounds the replay window.
    maxAssertionAgeMs: 5 * 60 * 1000,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  });
}

async function loadSamlConfig(
  prisma: PrismaClient,
  organizationId: string,
): Promise<SamlConfig> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });
  const config = parseStoredSsoConfig(settings?.ssoConfig);
  if (!config || config.type !== "SAML") {
    throw new SamlConfigError(
      `Organization ${organizationId} has no SAML configuration.`,
    );
  }
  return config;
}

export async function buildSamlLoginUrl(
  prisma: PrismaClient,
  organizationId: string,
  relayState = "/dashboard",
): Promise<string> {
  const config = await loadSamlConfig(prisma, organizationId);
  const saml = buildSamlStrategy(organizationId, config);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

export function generateSpMetadata(organizationId: string): string {
  // Any syntactically valid config works for metadata generation — only the
  // SP-side values (issuer/callbackUrl) appear in the output. Placeholder
  // values are used when the org hasn't finished configuring the IdP side,
  // so the admin can hand the IdP our metadata first (App Flow step 3).
  const saml = buildSamlStrategy(organizationId, {
    type: "SAML",
    entityId: "urn:placeholder",
    ssoUrl: "https://placeholder.invalid/sso",
    certificate: "0".repeat(64),
  });
  return saml.generateServiceProviderMetadata(null, null);
}

const EMAIL_ATTRIBUTE_CANDIDATES = [
  "email",
  "mail",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "urn:oid:0.9.2342.19200300.100.1.3",
];
const NAME_ATTRIBUTE_CANDIDATES = [
  "displayName",
  "name",
  "cn",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
];

/**
 * Validates a SAMLResponse (signature, audience, expiry — via node-saml)
 * and upserts the asserted user. Returns the user; the route layer mints
 * the session.
 */
export async function handleSamlCallback(
  prisma: PrismaClient,
  organizationId: string,
  samlResponseBase64: string,
  ipAddress?: string | null,
): Promise<User> {
  const config = await loadSamlConfig(prisma, organizationId);
  const saml = buildSamlStrategy(organizationId, config);

  let profile;
  try {
    const result = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponseBase64,
    });
    if (result.loggedOut || !result.profile) {
      throw new SamlValidationError("SAML response contained no profile.");
    }
    profile = result.profile;
  } catch (error) {
    if (error instanceof SamlValidationError) throw error;
    // Never leak validator internals (cert data, XML fragments) to callers.
    throw new SamlValidationError(
      `SAML response validation failed: ${(error as Error).message}`,
    );
  }

  const attributes = profile as unknown as Record<string, unknown>;
  const attributeValue = (candidates: string[]): string | null => {
    for (const key of candidates) {
      const match = Object.keys(attributes).find(
        (k) => k.toLowerCase() === key.toLowerCase(),
      );
      const value = match ? attributes[match] : undefined;
      const scalar = Array.isArray(value) ? value[0] : value;
      if (typeof scalar === "string" && scalar.length > 0) return scalar;
    }
    return null;
  };

  const email =
    attributeValue(EMAIL_ATTRIBUTE_CANDIDATES) ??
    (profile.nameID?.includes("@") ? profile.nameID : null);
  if (!email) {
    throw new SamlValidationError(
      "SAML assertion carried no email attribute and the NameID is not an email address.",
    );
  }

  try {
    return await upsertSsoUser({
      prisma,
      organizationId,
      email,
      name: attributeValue(NAME_ATTRIBUTE_CANDIDATES),
      provider: "saml",
      ipAddress,
    });
  } catch (error) {
    if (error instanceof SsoProvisioningError) {
      throw new SamlValidationError(error.publicMessage);
    }
    throw error;
  }
}
