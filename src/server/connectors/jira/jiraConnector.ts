import { ConnectorAdapter, EvidenceItem } from "../types";

interface JiraConnectorConfig {
  siteUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

function assertHttps(siteUrl: string): void {
  if (!siteUrl.startsWith("https://")) {
    throw new Error("Jira connector config requires an https:// siteUrl");
  }
}

function authHeaders(config: JiraConnectorConfig): HeadersInit {
  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
  };
}

function sanitizeJiraError(error: unknown): string {
  if (error instanceof Error) {
    if (/401/.test(error.message)) {
      return "Jira authentication failed: the email/API token pair is invalid.";
    }
    if (/403/.test(error.message)) {
      return "Jira API access denied. Verify the API token's permissions.";
    }
    if (/404/.test(error.message)) {
      return "Jira site, project, or resource not found with the provided configuration.";
    }
    return "Unable to connect to Jira with the provided configuration.";
  }
  return "Unknown Jira connection error.";
}

async function jiraFetch(path: string, config: JiraConnectorConfig): Promise<any> {
  assertHttps(config.siteUrl);
  const base = config.siteUrl.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new Error(`Jira API ${response.status} for ${path}`);
  }
  return response.json();
}

export class JiraConnector implements ConnectorAdapter {
  async testConnection(config: JiraConnectorConfig): Promise<boolean> {
    if (!config?.siteUrl || !config?.email || !config?.apiToken || !config?.projectKey) {
      throw new Error(
        "Jira connector config requires siteUrl, email, apiToken, and projectKey",
      );
    }
    // Validate the URL scheme before entering the try/catch below — a
    // config error like this isn't an external API failure and shouldn't be
    // genericized by sanitizeJiraError.
    assertHttps(config.siteUrl);
    try {
      const me = await jiraFetch("/rest/api/3/myself", config);
      return !!me.accountId;
    } catch (error) {
      throw new Error(sanitizeJiraError(error));
    }
  }

  listAvailableEvidenceTypes(): string[] {
    return ["jira_policy_approval_workflow_exists"];
  }

  async collectEvidence(type: string, config: JiraConnectorConfig): Promise<EvidenceItem[]> {
    const collectedAt = new Date();

    try {
      switch (type) {
        case "jira_policy_approval_workflow_exists": {
          // Jira workflow schemes vary enormously per org, so this is a
          // heuristic, not a verified check: it looks for a status literally
          // named "Approved" (case-insensitive) anywhere in the project's
          // statuses. Presence/absence maps to pass/fail, but the raw
          // statuses payload is always attached via metadata so a human can
          // review whether the heuristic actually matched the org's real
          // policy-approval gate.
          const statuses = await jiraFetch(
            `/rest/api/3/project/${config.projectKey}/statuses`,
            config,
          );

          const allStatusNames: string[] = (statuses as any[]).flatMap((issueType) =>
            (issueType.statuses || []).map((s: any) => s.name as string),
          );
          const hasApprovalGate = allStatusNames.some((name) =>
            /approved/i.test(name),
          );

          return [
            {
              id: `jira-policy-approval-${config.projectKey}-${collectedAt.getTime()}`,
              type,
              fileName: `${config.projectKey}-workflow-statuses.json`,
              summary: hasApprovalGate
                ? `Found an "Approved"-style status in project ${config.projectKey}'s workflow (heuristic match — verify manually)`
                : `No "Approved"-style status found in project ${config.projectKey}'s workflow`,
              collectedAt,
              metadata: { projectKey: config.projectKey, statuses },
              status: hasApprovalGate ? "pass" : "fail",
            },
          ];
        }
        default:
          throw new Error(`Unsupported Jira evidence type: ${type}`);
      }
    } catch (error) {
      throw new Error(sanitizeJiraError(error));
    }
  }
}
