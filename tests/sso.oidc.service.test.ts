// Phase 8 Part 1 — OIDC service tests. Discovery/token exchange are mocked
// at the openid-client boundary (network); the transaction-cookie integrity
// checks, PKCE/state/nonce plumbing, and user provisioning are exercised
// for real against the test database.
import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { Issuer } from "openid-client";

const mockCallback = jest.fn<any>();
const mockAuthorizationUrl = jest.fn<any>();
const mockCallbackParams = jest.fn<any>();

class FakeClient {
  constructor(public metadata: Record<string, unknown>) {}
  authorizationUrl(params: Record<string, string>) {
    mockAuthorizationUrl(params);
    const qs = new URLSearchParams(params).toString();
    return `https://idp.test/authorize?${qs}`;
  }
  callbackParams(url: string) {
    return mockCallbackParams(url);
  }
  callback(...args: unknown[]) {
    return mockCallback(...args);
  }
}

// Static-method spy instead of a module-factory mock: openid-client is ESM
// and next/jest's transform keeps live bindings, so factory mocks don't
// intercept the service's named import — spying on the class does.
jest.spyOn(Issuer, "discover").mockImplementation((url: string) =>
  Promise.resolve({
    metadata: {
      issuer: url,
      authorization_endpoint: "https://idp.test/authorize",
      token_endpoint: "https://idp.test/token",
    },
    Client: FakeClient,
  } as never),
);

import {
  buildOidcLoginRedirect,
  handleOidcCallback,
  discoverIssuer,
  oidcCallbackUrl,
  OidcValidationError,
} from "@/server/services/sso/oidc.service";
// eslint-disable-next-line import/first
import { encryptSsoSecret } from "@/server/lib/crypto/ssoVault";

const prisma = new PrismaClient();
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: `OidcOrg ${Date.now()}-${Math.random()}` },
  });
  const other = await prisma.organization.create({
    data: { name: `OidcOrgB ${Date.now()}-${Math.random()}` },
  });
  orgId = org.id;
  otherOrgId = other.id;
  for (const id of [orgId, otherOrgId]) {
    await prisma.organizationSettings.create({
      data: {
        organizationId: id,
        ssoConfig: {
          type: "OIDC",
          issuer: "https://idp.test",
          clientId: "dharma-client",
          clientSecretEnc: encryptSsoSecret("s3cret"),
        },
      },
    });
  }
});

afterAll(async () => {
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await prisma.organization.delete({ where: { id: otherOrgId } }).catch(() => undefined);
  await prisma.$disconnect();
});

describe("OIDC discovery", () => {
  it("refuses non-https issuers", async () => {
    await expect(discoverIssuer("http://idp.test")).rejects.toThrow(/https/);
  });
});

describe("OIDC login redirect", () => {
  it("builds a PKCE authorization URL and a matching encrypted transaction cookie", async () => {
    const { authorizationUrl, txCookieValue } = await buildOidcLoginRedirect(
      prisma,
      orgId,
    );

    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();

    // Cookie is opaque ciphertext, not the raw verifier.
    expect(txCookieValue).not.toContain(url.searchParams.get("state"));
  });
});

describe("OIDC callback", () => {
  const callbackUrlFor = (id: string) =>
    new URL(`${oidcCallbackUrl(id)}?code=abc&state=xyz`);

  it("rejects a missing transaction cookie", async () => {
    await expect(
      handleOidcCallback(prisma, orgId, callbackUrlFor(orgId), undefined),
    ).rejects.toThrow(OidcValidationError);
  });

  it("rejects a garbage transaction cookie", async () => {
    await expect(
      handleOidcCallback(prisma, orgId, callbackUrlFor(orgId), "AAAA:BBBB:CCCC"),
    ).rejects.toThrow(OidcValidationError);
  });

  it("tenant isolation: a transaction started for org A is rejected on org B's callback", async () => {
    const { txCookieValue } = await buildOidcLoginRedirect(prisma, orgId);
    await expect(
      handleOidcCallback(prisma, otherOrgId, callbackUrlFor(otherOrgId), txCookieValue),
    ).rejects.toThrow(/expired or mismatched/);
  });

  it("completes the code exchange with PKCE checks and JIT-provisions the user", async () => {
    const { authorizationUrl, txCookieValue } = await buildOidcLoginRedirect(
      prisma,
      orgId,
    );
    const authUrl = new URL(authorizationUrl);
    const state = authUrl.searchParams.get("state")!;

    mockCallbackParams.mockReturnValue({ code: "abc", state });
    mockCallback.mockResolvedValue({
      claims: () => ({
        sub: "idp-user-1",
        email: "bob@enterprise.test",
        name: "Bob Builder",
      }),
    });

    const user = await handleOidcCallback(
      prisma,
      orgId,
      new URL(`${oidcCallbackUrl(orgId)}?code=abc&state=${state}`),
      txCookieValue,
    );

    expect(user.email).toBe("bob@enterprise.test");
    expect(user.organizationId).toBe(orgId);
    expect(user.role).toBe(Role.VIEWER);

    // The verifier/state/nonce from the encrypted cookie must be handed to
    // openid-client's checks argument (that's what enforces PKCE + nonce).
    const checks = mockCallback.mock.calls[0][2] as Record<string, string>;
    expect(checks.state).toBe(state);
    expect(checks.code_verifier).toBeTruthy();
    expect(checks.nonce).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "SSO_LOGIN", entityId: user.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an ID token without an email claim", async () => {
    const { authorizationUrl, txCookieValue } = await buildOidcLoginRedirect(
      prisma,
      orgId,
    );
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    mockCallbackParams.mockReturnValue({ code: "abc", state });
    mockCallback.mockResolvedValue({ claims: () => ({ sub: "no-email" }) });

    await expect(
      handleOidcCallback(
        prisma,
        orgId,
        new URL(`${oidcCallbackUrl(orgId)}?code=abc&state=${state}`),
        txCookieValue,
      ),
    ).rejects.toThrow(/email claim/);
  });
});
