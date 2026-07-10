/**
 * Contract test suite: runs the same set of interface-conformance
 * assertions against every registered ConnectorAdapter (AWS, GitHub, Okta,
 * Jira). New connectors should be added to `adapters` below rather than
 * given their own bespoke conformance test — the goal is a single place
 * that guarantees every adapter honors the ConnectorAdapter contract
 * (types.ts) and fails predictably, not a place for connector-specific
 * behavior (that belongs in each connector's own *Connector.test.ts).
 */
import { AWSConnector } from "@/server/connectors/aws/awsConnector";
import { GithubConnector } from "@/server/connectors/github/githubConnector";
import { OktaConnector } from "@/server/connectors/okta/oktaConnector";
import { JiraConnector } from "@/server/connectors/jira/jiraConnector";
import type { ConnectorAdapter } from "@/server/connectors/types";

const adapters: { name: string; adapter: ConnectorAdapter }[] = [
  { name: "AWS", adapter: new AWSConnector() },
  { name: "GitHub", adapter: new GithubConnector() },
  { name: "Okta", adapter: new OktaConnector() },
  { name: "Jira", adapter: new JiraConnector() },
];

describe.each(adapters)("connectorAdapter contract — $name", ({ adapter }) => {
  it("implements testConnection, listAvailableEvidenceTypes, and collectEvidence", () => {
    expect(typeof adapter.testConnection).toBe("function");
    expect(typeof adapter.listAvailableEvidenceTypes).toBe("function");
    expect(typeof adapter.collectEvidence).toBe("function");
  });

  it("listAvailableEvidenceTypes returns a non-empty array of non-empty strings", () => {
    const types = adapter.listAvailableEvidenceTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(0);
    }
  });

  it("testConnection rejects with an Error (not a raw string/undefined) on invalid config", async () => {
    await expect(adapter.testConnection({})).rejects.toBeInstanceOf(Error);
  });

  it("testConnection's rejection on invalid config never includes the literal config object", async () => {
    // A defense-in-depth check for the security review pass (4.7): even a
    // trivially empty config should never round-trip into the error
    // message, which would set a bad precedent for connectors that do
    // interpolate config into error text.
    try {
      await adapter.testConnection({ secret: "should-never-appear", token: "should-never-appear" });
      fail("expected testConnection to reject on an incomplete config");
    } catch (err: any) {
      expect(err.message).not.toContain("should-never-appear");
    }
  });
});
