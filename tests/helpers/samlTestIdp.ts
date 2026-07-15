// Phase 8 Part 1 — minimal in-test SAML IdP: generates a throwaway key/cert
// with openssl and produces signed (or deliberately tampered) SAML responses
// so saml.service tests exercise REAL signature validation, not mocks.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SignedXml } from "xml-crypto";

export type TestIdpKeys = { privateKey: string; certificate: string };

export function generateIdpKeys(): TestIdpKeys {
  const dir = mkdtempSync(path.join(tmpdir(), "saml-test-idp-"));
  execSync(
    'openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 1 -nodes -subj "/CN=dharma-test-idp" 2>/dev/null',
    { cwd: dir },
  );
  return {
    privateKey: readFileSync(path.join(dir, "key.pem"), "utf8"),
    certificate: readFileSync(path.join(dir, "cert.pem"), "utf8"),
  };
}

/** Strips PEM armor — the format our SamlConfig stores (metadata-style). */
export function certBody(certificatePem: string): string {
  return certificatePem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export type SamlResponseOptions = {
  idpEntityId: string;
  audience: string;
  acsUrl: string;
  nameId: string;
  email?: string;
  displayName?: string;
  issueInstant?: Date;
  notOnOrAfter?: Date;
  keys: TestIdpKeys;
  /** false → leave the assertion unsigned. */
  sign?: boolean;
};

export function buildSamlResponseXml(options: SamlResponseOptions): string {
  const now = options.issueInstant ?? new Date();
  const notOnOrAfter =
    options.notOnOrAfter ?? new Date(now.getTime() + 5 * 60 * 1000);
  const notBefore = new Date(now.getTime() - 60 * 1000);
  const iso = (d: Date) => d.toISOString();
  const assertionId = `_a${Math.random().toString(16).slice(2)}`;
  const responseId = `_r${Math.random().toString(16).slice(2)}`;

  const attributes = [
    options.email
      ? `<saml:Attribute Name="email"><saml:AttributeValue>${options.email}</saml:AttributeValue></saml:Attribute>`
      : "",
    options.displayName
      ? `<saml:Attribute Name="displayName"><saml:AttributeValue>${options.displayName}</saml:AttributeValue></saml:Attribute>`
      : "",
  ].join("");

  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${iso(now)}" Destination="${options.acsUrl}">` +
    `<saml:Issuer>${options.idpEntityId}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${options.idpEntityId}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${options.nameId}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${options.acsUrl}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(notBefore)}" NotOnOrAfter="${iso(notOnOrAfter)}">` +
    `<saml:AudienceRestriction><saml:Audience>${options.audience}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` +
    `</saml:Assertion>` +
    `</samlp:Response>`;

  if (options.sign === false) return xml;

  const signed = new SignedXml({
    privateKey: options.keys.privateKey,
    publicCert: options.keys.certificate,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  signed.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  signed.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
  return signed.getSignedXml();
}

export function toSamlResponseParam(xml: string): string {
  return Buffer.from(xml, "utf8").toString("base64");
}

export function buildIdpMetadataXml(
  entityId: string,
  ssoUrl: string,
  keys: TestIdpKeys,
): string {
  return (
    `<?xml version="1.0"?>` +
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">` +
    `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
    `<md:KeyDescriptor use="signing">` +
    `<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${certBody(keys.certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `</md:KeyDescriptor>` +
    `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${ssoUrl}"/>` +
    `</md:IDPSSODescriptor>` +
    `</md:EntityDescriptor>`
  );
}
