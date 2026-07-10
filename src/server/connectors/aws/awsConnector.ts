// substituting aws-skills convention (closest available in the skills repo) for adapter-pattern + STS assume-role read-only access
import {
  STSClient,
  AssumeRoleCommand,
  type Credentials,
} from '@aws-sdk/client-sts';
import {
  ConfigServiceClient,
  DescribeConfigurationRecorderStatusCommand,
} from '@aws-sdk/client-config-service';
import {
  CloudTrailClient,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
} from '@aws-sdk/client-cloudtrail';
import { ConnectorAdapter, EvidenceItem } from '../types';

interface AwsConnectorConfig {
  roleArn: string;
  externalId: string;
  region?: string;
}

async function assumeConnectorRole(config: AwsConnectorConfig): Promise<Credentials> {
  if (!config?.roleArn || !config?.externalId) {
    throw new Error('AWS connector config requires roleArn and externalId');
  }

  const sts = new STSClient({ region: config.region || 'us-east-1' });
  const response = await sts.send(
    new AssumeRoleCommand({
      RoleArn: config.roleArn,
      ExternalId: config.externalId,
      RoleSessionName: 'dharma-connector-session',
      DurationSeconds: 900,
    }),
  );

  if (!response.Credentials) {
    throw new Error('AWS did not return temporary credentials for the assumed role');
  }

  return response.Credentials;
}

function credentialsToClientConfig(creds: Credentials, region: string) {
  return {
    region,
    credentials: {
      accessKeyId: creds.AccessKeyId!,
      secretAccessKey: creds.SecretAccessKey!,
      sessionToken: creds.SessionToken,
    },
  };
}

// Sanitize AWS SDK errors before they ever reach the client — never leak
// role ARNs, account IDs, or raw SDK stack traces.
function sanitizeAwsError(error: unknown): string {
  if (error instanceof Error) {
    if (/AccessDenied|not authorized/i.test(error.message)) {
      return 'Access denied: the provided role/external ID could not be assumed. Verify the trust policy.';
    }
    if (/InvalidClientTokenId|UnrecognizedClientException/i.test(error.message)) {
      return 'Invalid AWS credentials configuration.';
    }
    return 'Unable to connect to AWS with the provided configuration.';
  }
  return 'Unknown AWS connection error.';
}

export class AWSConnector implements ConnectorAdapter {
  async testConnection(config: AwsConnectorConfig): Promise<boolean> {
    try {
      const creds = await assumeConnectorRole(config);
      return !!creds.AccessKeyId;
    } catch (error) {
      throw new Error(sanitizeAwsError(error));
    }
  }

  listAvailableEvidenceTypes(): string[] {
    return [
      'aws_s3_encryption',
      'aws_cloudtrail_enabled',
      'aws_iam_mfa_enforced',
    ];
  }

  async collectEvidence(type: string, config: AwsConnectorConfig): Promise<EvidenceItem[]> {
    const region = config.region || 'us-east-1';
    let creds: Credentials;
    try {
      creds = await assumeConnectorRole(config);
    } catch (error) {
      throw new Error(sanitizeAwsError(error));
    }

    const clientConfig = credentialsToClientConfig(creds, region);
    const collectedAt = new Date();

    try {
      switch (type) {
        case 'aws_cloudtrail_enabled': {
          const cloudtrail = new CloudTrailClient(clientConfig);
          const trails = await cloudtrail.send(new DescribeTrailsCommand({}));
          const items: EvidenceItem[] = [];
          for (const trail of trails.trailList || []) {
            const status = trail.Name
              ? await cloudtrail.send(new GetTrailStatusCommand({ Name: trail.Name }))
              : undefined;
            items.push({
              id: `cloudtrail-${trail.Name}`,
              type,
              fileName: `${trail.Name || 'trail'}-status.json`,
              summary: status?.IsLogging ? 'CloudTrail logging enabled' : 'CloudTrail logging disabled',
              collectedAt,
              metadata: { trail, status },
              status: status?.IsLogging ? 'pass' : 'fail',
            });
          }
          return items;
        }
        case 'aws_iam_mfa_enforced': {
          const configService = new ConfigServiceClient(clientConfig);
          const recorderStatus = await configService.send(
            new DescribeConfigurationRecorderStatusCommand({}),
          );
          // NOTE: this does not yet actually check IAM MFA enforcement — it only
          // snapshots the AWS Config recorder status. No real pass/fail signal is
          // computed here, so status is "unknown" rather than a fabricated verdict.
          // A real check (e.g. IAM GetAccountSummary / list users without MFA) is
          // out of scope for Part 2 and should be tracked as a follow-up.
          return [
            {
              id: `config-recorder-${collectedAt.getTime()}`,
              type,
              fileName: 'config-recorder-status.json',
              summary: 'AWS Config recorder status snapshot',
              collectedAt,
              metadata: { recorderStatus },
              status: 'unknown',
            },
          ];
        }
        case 'aws_s3_encryption':
          // Bucket-level enumeration is out of scope for Part 1 (manual test flow only).
          return [];
        default:
          throw new Error(`Unsupported AWS evidence type: ${type}`);
      }
    } catch (error) {
      throw new Error(sanitizeAwsError(error));
    }
  }
}
