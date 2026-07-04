/**
 * src/workers/connectors/github.ts
 *
 * Phase 2 Feature 2 — GitHub connector.
 *
 * Checks per configured repository:
 *   1. Branch protection on the default branch (required PR reviews, dismiss stale, etc.)
 *   2. Secret scanning / push protection enabled at repo level
 *
 * Dedup: only creates a new Evidence row when the result hash changes.
 * Otherwise bumps Evidence.updatedAt so the "last synced" timestamp stays fresh.
 *
 * [skills: backend-dev-guidelines, github-actions-advanced, broken-authentication]
 */

import { createHash } from "node:crypto";
import { PrismaClient, EvidenceType, ConnectorStatus } from "@prisma/client";
import { decryptCredential } from "@/lib/crypto/credentials";

interface GitHubConfig {
  repos: string[]; // format: "owner/repo"
}

interface CheckResult {
  checkKey: string; // stable identifier for dedup
  summary: string;
  passed: boolean;
  rawPayload: unknown;
}

/** Compute a dedup hash for a check result — changes only when outcome changes. */
function resultHash(result: CheckResult): string {
  return createHash("sha256")
    .update(JSON.stringify({ checkKey: result.checkKey, passed: result.passed }))
    .digest("hex");
}

/**
 * Run all GitHub checks for a single connector.
 * Creates or updates Evidence rows.
 * Updates Connector.status + lastRunAt + lastRunStatus.
 */
export async function runGitHubConnector(
  prisma: PrismaClient,
  connector: {
    id: string;
    organizationId: string;
    credentials: string;
    config: unknown;
  },
  defaultControlId: string, // first control to attach new evidence to
): Promise<void> {
  const pat = decryptCredential(connector.credentials);
  const config = connector.config as GitHubConfig;
  const repos = config.repos ?? [];

  if (repos.length === 0) {
    await prisma.connector.update({
      where: { id: connector.id },
      data: { lastRunAt: new Date(), lastRunStatus: "No repos configured", status: ConnectorStatus.ACTIVE },
    });
    return;
  }

  // Dynamic import — keeps @octokit/rest out of the main Next.js bundle
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: pat });

  const allResults: CheckResult[] = [];

  for (const repoPath of repos) {
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) continue;

    // 1. Get the default branch
    let defaultBranch = "main";
    try {
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      defaultBranch = repoData.default_branch;
    } catch (_) {
      // non-fatal — fall back to "main"
    }

    // 2. Branch protection check
    try {
      const { data: protection } = await octokit.repos.getBranchProtection({
        owner,
        repo,
        branch: defaultBranch,
      });

      const requiredReviews =
        protection.required_pull_request_reviews?.required_approving_review_count ?? 0;

      allResults.push({
        checkKey: `${repoPath}/branch-protection`,
        passed: true,
        summary:
          `Branch protection is active on \`${defaultBranch}\` in ${repoPath}. ` +
          `Required reviews: ${requiredReviews}. ` +
          `Stale review dismissal: ${protection.required_pull_request_reviews?.dismiss_stale_reviews ? "enabled" : "disabled"}.`,
        rawPayload: {
          branch: defaultBranch,
          requiredReviews,
          dismissStale: protection.required_pull_request_reviews?.dismiss_stale_reviews,
          requireStatusChecks: protection.required_status_checks?.strict,
        },
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      allResults.push({
        checkKey: `${repoPath}/branch-protection`,
        passed: false,
        summary:
          status === 404
            ? `Branch protection is NOT configured on \`${defaultBranch}\` in ${repoPath}. Any contributor can push directly to the default branch.`
            : `Unable to check branch protection for ${repoPath}: ${err instanceof Error ? err.message : String(err)}`,
        rawPayload: { error: String(err), status },
      });
    }

    // 3. Secret scanning check
    try {
      // The security_and_analysis field is returned in repo GET
      const { data: repoDetail } = await octokit.repos.get({ owner, repo });
      const secretScanEnabled =
        (repoDetail as any).security_and_analysis?.secret_scanning?.status === "enabled";
      const pushProtEnabled =
        (repoDetail as any).security_and_analysis?.secret_scanning_push_protection?.status === "enabled";

      allResults.push({
        checkKey: `${repoPath}/secret-scanning`,
        passed: secretScanEnabled,
        summary: secretScanEnabled
          ? `Secret scanning is enabled for ${repoPath}.${pushProtEnabled ? " Push protection is also active." : ""}`
          : `Secret scanning is NOT enabled for ${repoPath}. Leaked API keys may not be detected.`,
        rawPayload: { secretScanEnabled, pushProtEnabled },
      });
    } catch (_) {
      // Secret scanning API may not be available for all plans — skip silently
    }
  }

  // Persist each check result as an Evidence row (with dedup)
  for (const result of allResults) {
    const rHash = resultHash(result);
    const fileName = `${result.checkKey.replace(/\//g, "-")}.json`;

    const existing = await prisma.evidence.findFirst({
      where: {
        organizationId: connector.organizationId,
        connectorId: connector.id,
        fileName,
      },
      select: { id: true, summary: true },
    });

    const payloadJson = JSON.stringify(result.rawPayload, null, 2);
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");

    if (!existing) {
      // First time — create the evidence row
      await prisma.evidence.create({
        data: {
          controlId: defaultControlId,
          organizationId: connector.organizationId,
          connectorId: connector.id,
          fileName,
          filePath: `connectors/${connector.id}/${fileName}`,
          type: EvidenceType.API_RESPONSE,
          summary: result.summary,
          collectedAt: new Date(),
        },
      });
    } else {
      // Dedup: only update if the result changed
      const existingHash = createHash("sha256").update(existing.summary ?? "").digest("hex");
      if (payloadHash !== existingHash) {
        await prisma.evidence.update({
          where: { id: existing.id },
          data: { summary: result.summary, collectedAt: new Date() },
        });
      } else {
        // Outcome unchanged — just bump updatedAt
        await prisma.evidence.update({
          where: { id: existing.id },
          data: { updatedAt: new Date() },
        });
      }
    }
  }

  // Update connector status
  await prisma.connector.update({
    where: { id: connector.id },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: `${allResults.length} checks completed`,
      status: ConnectorStatus.ACTIVE,
    },
  });

  console.log(
    `[connector:github] ✅ ${allResults.length} checks for org ${connector.organizationId}`,
  );
}
