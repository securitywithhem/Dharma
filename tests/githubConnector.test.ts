import { GithubConnector } from "@/server/connectors/github/githubConnector";

const globalAny = global as any;

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("GithubConnector", () => {
  const connector = new GithubConnector();
  const config = { installationToken: "ghp_test", org: "dharma-org" };

  beforeEach(() => {
    globalAny.fetch = jest.fn();
  });

  describe("testConnection", () => {
    it("throws when required config fields are missing", async () => {
      await expect(connector.testConnection({} as any)).rejects.toThrow(
        /requires installationToken and org/,
      );
    });

    it("returns true on a successful org lookup", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ id: 123 }));
      await expect(connector.testConnection(config)).resolves.toBe(true);
      expect(globalAny.fetch).toHaveBeenCalledWith(
        "https://api.github.com/orgs/dharma-org",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer ghp_test" }) }),
      );
    });

    it("throws a sanitized error on 401 without leaking the token", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({}, false, 401));
      await expect(connector.testConnection(config)).rejects.toThrow(/authentication failed/i);
      try {
        await connector.testConnection(config);
      } catch (err: any) {
        expect(err.message).not.toContain("ghp_test");
      }
    });
  });

  describe("listAvailableEvidenceTypes", () => {
    it("returns the three GitHub evidence types", () => {
      expect(connector.listAvailableEvidenceTypes()).toEqual([
        "github_branch_protection_enabled",
        "github_required_reviews",
        "github_2fa_enforced",
      ]);
    });
  });

  describe("collectEvidence", () => {
    it("maps 2FA enforcement to pass/fail based on the org flag", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ id: 1, two_factor_requirement_enabled: true }));
      const items = await connector.collectEvidence("github_2fa_enforced", config);
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("pass");
    });

    it("maps missing 2FA enforcement to fail", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ id: 1, two_factor_requirement_enabled: false }));
      const items = await connector.collectEvidence("github_2fa_enforced", config);
      expect(items[0].status).toBe("fail");
    });

    it("maps branch protection presence/absence per repo", async () => {
      const repoConfig = { ...config, repos: ["repo-a"] };
      globalAny.fetch
        .mockResolvedValueOnce(jsonResponse({ default_branch: "main" })) // GET repo
        .mockResolvedValueOnce(jsonResponse({ required_pull_request_reviews: { required_approving_review_count: 1 } })); // GET protection

      const items = await connector.collectEvidence("github_branch_protection_enabled", repoConfig);
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("pass");
    });

    it("marks branch protection as fail when the protection endpoint 404s", async () => {
      const repoConfig = { ...config, repos: ["repo-a"] };
      globalAny.fetch
        .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
        .mockResolvedValueOnce(jsonResponse({}, false, 404));

      const items = await connector.collectEvidence("github_branch_protection_enabled", repoConfig);
      expect(items[0].status).toBe("fail");
    });

    it("throws on an unsupported evidence type", async () => {
      await expect(
        connector.collectEvidence("not_a_real_type", config),
      ).rejects.toThrow(/Unable to connect/);
    });
  });
});
