/**
 * src/workers/connectors/aws.ts
 *
 * Phase 2 Feature 2 — AWS connector.
 *
 * Checks:
 *   1. S3 buckets — public access block status + default encryption
 *   2. RDS instances — PubliclyAccessible flag + StorageEncrypted flag
 *
 * [skills: backend-dev-guidelines, broken-authentication]
 */

import { createHash } from "node:crypto";
import { PrismaClient, EvidenceType, ConnectorStatus } from "@prisma/client";
import { decryptCredential } from "@/lib/crypto/credentials";

interface AWSConfig {
  regions: string[]; // e.g. ["ap-south-1", "us-east-1"]
  accessKeyId: string;
  secretAccessKey: string;
}

interface CheckResult {
  checkKey: string;
  summary: string;
  passed: boolean;
  rawPayload: unknown;
}

export async function runAWSConnector(
  prisma: PrismaClient,
  connector: {
    id: string;
    organizationId: string;
    credentials: string;
    config: unknown;
  },
  defaultControlId: string,
): Promise<void> {
  const credsJson = decryptCredential(connector.credentials);
  const awsCreds = JSON.parse(credsJson) as { accessKeyId: string; secretAccessKey: string };
  const config = connector.config as AWSConfig;
  const regions = config.regions ?? ["ap-south-1"];

  const { S3Client, GetBucketEncryptionCommand, GetPublicAccessBlockCommand, ListBucketsCommand } =
    await import("@aws-sdk/client-s3");
  const { RDSClient, DescribeDBInstancesCommand } = await import("@aws-sdk/client-rds");

  const allResults: CheckResult[] = [];

  for (const region of regions) {
    const credentials = {
      accessKeyId: awsCreds.accessKeyId,
      secretAccessKey: awsCreds.secretAccessKey,
    };

    // ── S3 checks ────────────────────────────────────────────────────────
    const s3 = new S3Client({ region, credentials });
    let buckets: string[] = [];

    try {
      const { Buckets } = await s3.send(new ListBucketsCommand({}));
      buckets = (Buckets ?? []).map((b) => b.Name!).filter(Boolean);
    } catch (err) {
      allResults.push({
        checkKey: `aws/${region}/s3/list`,
        passed: false,
        summary: `Unable to list S3 buckets in ${region}: ${err instanceof Error ? err.message : String(err)}`,
        rawPayload: { error: String(err) },
      });
    }

    for (const bucket of buckets) {
      // Public access block
      try {
        const { PublicAccessBlockConfiguration: pab } = await s3.send(
          new GetPublicAccessBlockCommand({ Bucket: bucket }),
        );
        const fullyBlocked =
          pab?.BlockPublicAcls &&
          pab?.BlockPublicPolicy &&
          pab?.IgnorePublicAcls &&
          pab?.RestrictPublicBuckets;

        allResults.push({
          checkKey: `aws/${region}/s3/${bucket}/public-access`,
          passed: !!fullyBlocked,
          summary: fullyBlocked
            ? `S3 bucket "${bucket}" has all public access blocks enabled.`
            : `S3 bucket "${bucket}" is missing public access blocks — potential data exposure.`,
          rawPayload: pab,
        });
      } catch (_) {
        allResults.push({
          checkKey: `aws/${region}/s3/${bucket}/public-access`,
          passed: false,
          summary: `Unable to check public access block for S3 bucket "${bucket}" in ${region}.`,
          rawPayload: null,
        });
      }

      // Default encryption
      try {
        const { ServerSideEncryptionConfiguration: sse } = await s3.send(
          new GetBucketEncryptionCommand({ Bucket: bucket }),
        );
        const encrypted = (sse?.Rules ?? []).length > 0;
        allResults.push({
          checkKey: `aws/${region}/s3/${bucket}/encryption`,
          passed: encrypted,
          summary: encrypted
            ? `S3 bucket "${bucket}" has default server-side encryption enabled.`
            : `S3 bucket "${bucket}" does NOT have default encryption — data at rest may be unencrypted.`,
          rawPayload: sse?.Rules ?? [],
        });
      } catch (_) {
        allResults.push({
          checkKey: `aws/${region}/s3/${bucket}/encryption`,
          passed: false,
          summary: `Unable to check encryption for S3 bucket "${bucket}" in ${region}.`,
          rawPayload: null,
        });
      }
    }

    // ── RDS checks ────────────────────────────────────────────────────────
    try {
      const rds = new RDSClient({ region, credentials });
      const { DBInstances } = await rds.send(new DescribeDBInstancesCommand({}));

      for (const db of DBInstances ?? []) {
        const id = db.DBInstanceIdentifier ?? "unknown";

        allResults.push({
          checkKey: `aws/${region}/rds/${id}/public`,
          passed: !db.PubliclyAccessible,
          summary: db.PubliclyAccessible
            ? `RDS instance "${id}" in ${region} is publicly accessible — restrict network access.`
            : `RDS instance "${id}" in ${region} is not publicly accessible. ✅`,
          rawPayload: { id, publiclyAccessible: db.PubliclyAccessible },
        });

        allResults.push({
          checkKey: `aws/${region}/rds/${id}/encryption`,
          passed: !!db.StorageEncrypted,
          summary: db.StorageEncrypted
            ? `RDS instance "${id}" in ${region} has storage encryption enabled. ✅`
            : `RDS instance "${id}" in ${region} does NOT have storage encryption — data at rest is unencrypted.`,
          rawPayload: { id, storageEncrypted: db.StorageEncrypted },
        });
      }
    } catch (err) {
      allResults.push({
        checkKey: `aws/${region}/rds/list`,
        passed: false,
        summary: `Unable to list RDS instances in ${region}: ${err instanceof Error ? err.message : String(err)}`,
        rawPayload: { error: String(err) },
      });
    }
  }

  // Persist results with dedup
  for (const result of allResults) {
    const fileName = `${result.checkKey.replace(/\//g, "-")}.json`;
    const existing = await prisma.evidence.findFirst({
      where: { organizationId: connector.organizationId, connectorId: connector.id, fileName },
      select: { id: true, summary: true },
    });

    if (!existing) {
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
    } else if (existing.summary !== result.summary) {
      await prisma.evidence.update({
        where: { id: existing.id },
        data: { summary: result.summary, collectedAt: new Date() },
      });
    } else {
      await prisma.evidence.update({ where: { id: existing.id }, data: { updatedAt: new Date() } });
    }
  }

  await prisma.connector.update({
    where: { id: connector.id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      status: ConnectorStatus.CONNECTED,
    },
  });

  console.log(
    `[connector:aws] ✅ ${allResults.length} checks for org ${connector.organizationId}`,
  );
}
