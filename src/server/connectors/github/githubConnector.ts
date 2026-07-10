// Read-only GitHub connector. Uses plain fetch against the REST API rather
// than pulling in the octokit dependency, matching the "no new heavy SDK for
// a handful of endpoints" scope of the other Part 3 connectors — the AWS
// connector uses the official SDK because it needs STS role assumption,
// which has no plain-HTTP equivalent; GitHub's REST API doesn't need that.
import { ConnectorAdapter, EvidenceItem } from "../types";

interface GithubConnectorConfig {
  installationToken: string;
  org: string;
  repos?: string[];
}

const GITHUB_API = "https://api.github.com";

function authHeaders(config: GithubConnectorConfig): HeadersInit {
  return {
    Authorization: `Bearer ${config.installationToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Sanitize errors before they reach the client — never leak the installation
// token in a thrown message.
function sanitizeGithubError(error: unknown): string {
  if (error instanceof Error) {
    if (/401|Bad credentials/i.test(error.message)) {
      return "GitHub authentication failed: the installation token is invalid or expired.";
    }
    if (/403|rate limit/i.test(error.message)) {
      return "GitHub API access denied or rate-limited. Verify token scopes.";
    }
    if (/404/.test(error.message)) {
      return "GitHub organization or repository not found with the provided token.";
    }
    return "Unable to connect to GitHub with the provided configuration.";
  }
  return "Unknown GitHub connection error.";
}

async function githubFetch(path: string, config: GithubConnectorConfig): Promise<any> {
  const response = await fetch(`${GITHUB_API}${path}`, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  return response.json();
}

async function resolveRepos(config: GithubConnectorConfig): Promise<string[]> {
  if (config.repos && config.repos.length > 0) {
    return config.repos;
  }
  const repos = await githubFetch(`/orgs/${config.org}/repos?per_page=100`, config);
  return (repos as any[]).map((r) => r.name);
}

export class GithubConnector implements ConnectorAdapter {
  async testConnection(config: GithubConnectorConfig): Promise<boolean> {
    if (!config?.installationToken || !config?.org) {
      throw new Error("GitHub connector config requires installationToken and org");
    }
    try {
      const org = await githubFetch(`/orgs/${config.org}`, config);
      return !!org.id;
    } catch (error) {
      throw new Error(sanitizeGithubError(error));
    }
  }

  listAvailableEvidenceTypes(): string[] {
    return [
      "github_branch_protection_enabled",
      "github_required_reviews",
      "github_2fa_enforced",
    ];
  }

  async collectEvidence(type: string, config: GithubConnectorConfig): Promise<EvidenceItem[]> {
    const collectedAt = new Date();

    try {
      switch (type) {
        case "github_2fa_enforced": {
          const org = await githubFetch(`/orgs/${config.org}`, config);
          const enforced = !!org.two_factor_requirement_enabled;
          return [
            {
              id: `github-2fa-${config.org}`,
              type,
              fileName: `${config.org}-2fa-status.json`,
              summary: enforced
                ? "GitHub org requires two-factor authentication"
                : "GitHub org does not require two-factor authentication",
              collectedAt,
              metadata: { org: config.org, two_factor_requirement_enabled: enforced },
              status: enforced ? "pass" : "fail",
            },
          ];
        }
        case "github_branch_protection_enabled":
        case "github_required_reviews": {
          const repos = await resolveRepos(config);
          const items: EvidenceItem[] = [];

          for (const repo of repos) {
            const repoInfo = await githubFetch(`/repos/${config.org}/${repo}`, config);
            const defaultBranch = repoInfo.default_branch || "main";

            let protection: any = null;
            let protectionEnabled = false;
            try {
              protection = await githubFetch(
                `/repos/${config.org}/${repo}/branches/${defaultBranch}/protection`,
                config,
              );
              protectionEnabled = true;
            } catch {
              // 404 on the protection endpoint means the branch has no
              // protection rule configured at all — not an error, just "fail".
              protectionEnabled = false;
            }

            if (type === "github_branch_protection_enabled") {
              items.push({
                id: `github-branch-protection-${repo}`,
                type,
                fileName: `${repo}-branch-protection.json`,
                summary: protectionEnabled
                  ? `Branch protection enabled on ${repo}/${defaultBranch}`
                  : `No branch protection on ${repo}/${defaultBranch}`,
                collectedAt,
                metadata: { repo, defaultBranch, protection },
                status: protectionEnabled ? "pass" : "fail",
              });
            } else {
              const requiredReviews = !!protection?.required_pull_request_reviews;
              items.push({
                id: `github-required-reviews-${repo}`,
                type,
                fileName: `${repo}-required-reviews.json`,
                summary: requiredReviews
                  ? `Required PR reviews enforced on ${repo}/${defaultBranch}`
                  : `Required PR reviews not enforced on ${repo}/${defaultBranch}`,
                collectedAt,
                metadata: { repo, defaultBranch, required_pull_request_reviews: protection?.required_pull_request_reviews ?? null },
                status: requiredReviews ? "pass" : "fail",
              });
            }
          }

          return items;
        }
        default:
          throw new Error(`Unsupported GitHub evidence type: ${type}`);
      }
    } catch (error) {
      throw new Error(sanitizeGithubError(error));
    }
  }
}
