
// WAVE 8: these are unit tests of signing / auth / payload behaviour, not of
// network egress. The call site now goes through safeFetch, whose SSRF guard
// does a real DNS lookup and refuses private space — which would (correctly)
// block this suite's fixture hosts, including any local stub server.
//
// Delegating safeFetch to global.fetch keeps this suite testing what it is
// for. The egress guarantee is owned by tests/ssrfGuard.test.ts, which also
// asserts statically that none of the five BE-4 call sites has regressed back
// to a bare fetch() — so mocking here cannot hide a reintroduced hole.
jest.mock("@/server/lib/net/assertPublicHttpTarget", () => {
  const actual = jest.requireActual("@/server/lib/net/assertPublicHttpTarget");
  return {
    ...actual,
    safeFetch: (url: string, init?: RequestInit) => {
      const { maxRedirects: _maxRedirects, allowedProtocols: _allowedProtocols, ...rest } =
        (init ?? {}) as Record<string, unknown>;
      return (global.fetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, rest);
    },
  };
});

import { OktaConnector } from "@/server/connectors/okta/oktaConnector";

const globalAny = global as any;

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("OktaConnector", () => {
  const connector = new OktaConnector();
  const config = { oktaDomain: "dharma.okta.com", apiToken: "okta_test_token" };

  beforeEach(() => {
    globalAny.fetch = jest.fn();
  });

  describe("testConnection", () => {
    it("throws when required config fields are missing", async () => {
      await expect(connector.testConnection({} as any)).rejects.toThrow(
        /requires oktaDomain and apiToken/,
      );
    });

    it("always constructs an https:// URL, even if oktaDomain has no scheme", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ id: "org1" }));
      await connector.testConnection(config);
      expect(globalAny.fetch).toHaveBeenCalledWith(
        "https://dharma.okta.com/api/v1/org",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "SSWS okta_test_token" }) }),
      );
    });

    it("strips an http:// scheme if present rather than using it", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ id: "org1" }));
      await connector.testConnection({ ...config, oktaDomain: "http://dharma.okta.com" });
      expect(globalAny.fetch).toHaveBeenCalledWith(
        "https://dharma.okta.com/api/v1/org",
        expect.anything(),
      );
    });

    it("throws a sanitized error on 401 without leaking the token", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({}, false, 401));
      try {
        await connector.testConnection(config);
        fail("expected to throw");
      } catch (err: any) {
        expect(err.message).not.toContain("okta_test_token");
        expect(err.message).toMatch(/authentication failed/i);
      }
    });
  });

  describe("collectEvidence", () => {
    it("marks MFA enforced pass when an active MFA_ENROLL policy exists", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse([{ id: "p1", status: "ACTIVE" }]));
      const items = await connector.collectEvidence("okta_mfa_enforced", config);
      expect(items[0].status).toBe("pass");
    });

    it("marks MFA enforced fail when no active MFA_ENROLL policy exists", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse([{ id: "p1", status: "INACTIVE" }]));
      const items = await connector.collectEvidence("okta_mfa_enforced", config);
      expect(items[0].status).toBe("fail");
    });

    it("marks password policy as unknown when no active policy exists", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse([]));
      const items = await connector.collectEvidence("okta_password_policy_compliant", config);
      expect(items[0].status).toBe("unknown");
    });

    it("marks password policy pass when active policy meets min length", async () => {
      globalAny.fetch.mockResolvedValue(
        jsonResponse([
          { id: "p1", status: "ACTIVE", settings: { password: { complexity: { minLength: 10 } } } },
        ]),
      );
      const items = await connector.collectEvidence("okta_password_policy_compliant", config);
      expect(items[0].status).toBe("pass");
    });

    it("marks password policy fail when active policy is below min length", async () => {
      globalAny.fetch.mockResolvedValue(
        jsonResponse([
          { id: "p1", status: "ACTIVE", settings: { password: { complexity: { minLength: 4 } } } },
        ]),
      );
      const items = await connector.collectEvidence("okta_password_policy_compliant", config);
      expect(items[0].status).toBe("fail");
    });
  });
});
