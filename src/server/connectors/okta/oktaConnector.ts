import { ConnectorAdapter, EvidenceItem } from "../types";

interface OktaConnectorConfig {
  oktaDomain: string;
  apiToken: string;
}

// oktaDomain is a bare hostname (e.g. "dharma.okta.com"), never a full URL —
// the connector always constructs the URL with https:// itself, so a
// user-supplied http:// scheme can never reach an outbound call.
function baseUrl(config: OktaConnectorConfig): string {
  const domain = config.oktaDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}`;
}

function authHeaders(config: OktaConnectorConfig): HeadersInit {
  return {
    Authorization: `SSWS ${config.apiToken}`,
    Accept: "application/json",
  };
}

function sanitizeOktaError(error: unknown): string {
  if (error instanceof Error) {
    if (/401/.test(error.message)) {
      return "Okta authentication failed: the API token is invalid or expired.";
    }
    if (/403/.test(error.message)) {
      return "Okta API access denied. Verify the token has the required scopes.";
    }
    if (/404/.test(error.message)) {
      return "Okta domain or resource not found with the provided configuration.";
    }
    return "Unable to connect to Okta with the provided configuration.";
  }
  return "Unknown Okta connection error.";
}

async function oktaFetch(path: string, config: OktaConnectorConfig): Promise<any> {
  const response = await fetch(`${baseUrl(config)}${path}`, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new Error(`Okta API ${response.status} for ${path}`);
  }
  return response.json();
}

export class OktaConnector implements ConnectorAdapter {
  async testConnection(config: OktaConnectorConfig): Promise<boolean> {
    if (!config?.oktaDomain || !config?.apiToken) {
      throw new Error("Okta connector config requires oktaDomain and apiToken");
    }
    try {
      const org = await oktaFetch("/api/v1/org", config);
      return !!org.id;
    } catch (error) {
      throw new Error(sanitizeOktaError(error));
    }
  }

  listAvailableEvidenceTypes(): string[] {
    return ["okta_mfa_enforced", "okta_password_policy_compliant"];
  }

  async collectEvidence(type: string, config: OktaConnectorConfig): Promise<EvidenceItem[]> {
    const collectedAt = new Date();

    try {
      switch (type) {
        case "okta_mfa_enforced": {
          const policies = await oktaFetch("/api/v1/policies?type=MFA_ENROLL", config);
          const activePolicies = (policies as any[]).filter((p) => p.status === "ACTIVE");
          const enforced = activePolicies.length > 0;
          return [
            {
              id: `okta-mfa-enroll-${collectedAt.getTime()}`,
              type,
              fileName: "okta-mfa-enroll-policies.json",
              summary: enforced
                ? `${activePolicies.length} active MFA enrollment polic${activePolicies.length === 1 ? "y" : "ies"} found`
                : "No active MFA enrollment policy found",
              collectedAt,
              metadata: { policies },
              status: enforced ? "pass" : "fail",
            },
          ];
        }
        case "okta_password_policy_compliant": {
          const policies = await oktaFetch("/api/v1/policies?type=PASSWORD", config);
          const activePolicies = (policies as any[]).filter((p) => p.status === "ACTIVE");
          // Heuristic per org-specific password requirements — flags "needs
          // manual review" rather than fabricating a pass/fail verdict when
          // there's no active policy to evaluate at all.
          if (activePolicies.length === 0) {
            return [
              {
                id: `okta-password-policy-${collectedAt.getTime()}`,
                type,
                fileName: "okta-password-policies.json",
                summary: "No active password policy found",
                collectedAt,
                metadata: { policies },
                status: "unknown",
              },
            ];
          }
          const minLengthOk = activePolicies.every(
            (p) => (p.settings?.password?.complexity?.minLength ?? 0) >= 8,
          );
          return [
            {
              id: `okta-password-policy-${collectedAt.getTime()}`,
              type,
              fileName: "okta-password-policies.json",
              summary: minLengthOk
                ? "Active password policy meets minimum length requirement (>=8)"
                : "Active password policy does not meet minimum length requirement",
              collectedAt,
              metadata: { policies },
              status: minLengthOk ? "pass" : "fail",
            },
          ];
        }
        default:
          throw new Error(`Unsupported Okta evidence type: ${type}`);
      }
    } catch (error) {
      throw new Error(sanitizeOktaError(error));
    }
  }
}
