import { JiraConnector } from "@/server/connectors/jira/jiraConnector";

const globalAny = global as any;

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("JiraConnector", () => {
  const connector = new JiraConnector();
  const config = {
    siteUrl: "https://dharma.atlassian.net",
    email: "admin@dharma.com",
    apiToken: "jira_test_token",
    projectKey: "COMP",
  };

  beforeEach(() => {
    globalAny.fetch = jest.fn();
  });

  describe("testConnection", () => {
    it("throws when required config fields are missing", async () => {
      await expect(connector.testConnection({} as any)).rejects.toThrow(
        /requires siteUrl, email, apiToken, and projectKey/,
      );
    });

    it("rejects a non-HTTPS siteUrl at validation time", async () => {
      await expect(
        connector.testConnection({ ...config, siteUrl: "http://dharma.atlassian.net" }),
      ).rejects.toThrow(/https/i);
    });

    it("returns true on a successful /myself lookup using Basic auth", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({ accountId: "acc1" }));
      await expect(connector.testConnection(config)).resolves.toBe(true);

      const expectedAuth = `Basic ${Buffer.from("admin@dharma.com:jira_test_token").toString("base64")}`;
      expect(globalAny.fetch).toHaveBeenCalledWith(
        "https://dharma.atlassian.net/rest/api/3/myself",
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expectedAuth }) }),
      );
    });

    it("throws a sanitized error on 401 without leaking the API token", async () => {
      globalAny.fetch.mockResolvedValue(jsonResponse({}, false, 401));
      try {
        await connector.testConnection(config);
        fail("expected to throw");
      } catch (err: any) {
        expect(err.message).not.toContain("jira_test_token");
        expect(err.message).toMatch(/authentication failed/i);
      }
    });
  });

  describe("listAvailableEvidenceTypes", () => {
    it("returns the single Jira evidence type", () => {
      expect(connector.listAvailableEvidenceTypes()).toEqual([
        "jira_policy_approval_workflow_exists",
      ]);
    });
  });

  describe("collectEvidence", () => {
    it("marks pass when an 'Approved'-style status is found and attaches raw statuses in metadata", async () => {
      globalAny.fetch.mockResolvedValue(
        jsonResponse([{ id: "10001", statuses: [{ name: "To Do" }, { name: "Approved" }] }]),
      );
      const items = await connector.collectEvidence("jira_policy_approval_workflow_exists", config);
      expect(items[0].status).toBe("pass");
      expect(items[0].metadata.statuses).toBeDefined();
    });

    it("marks fail when no 'Approved'-style status is found", async () => {
      globalAny.fetch.mockResolvedValue(
        jsonResponse([{ id: "10001", statuses: [{ name: "To Do" }, { name: "Done" }] }]),
      );
      const items = await connector.collectEvidence("jira_policy_approval_workflow_exists", config);
      expect(items[0].status).toBe("fail");
    });
  });
});
