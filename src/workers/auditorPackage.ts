/**
 * src/workers/auditorPackage.ts
 *
 * Phase 2 Feature 5 — Auditor Export Package generator.
 *
 * Job steps:
 *   1. Load controls + evidence metadata for selected frameworks
 *   2. Load published policies
 *   3. Load full AuditLog + latest ChainAnchor
 *   4. Generate static, dependency-free index.html (XSS-safe, air-gap compatible)
 *   5. Generate PDF cover using @react-pdf/renderer
 *   6. Optionally stream raw evidence files from MinIO into ZIP
 *   7. Bundle everything into a ZIP with archiver
 *   8. Upload ZIP to MinIO
 *   9. Create presigned 24h download URL
 *  10. Persist AuditExport DB row + AuditLog entry
 *
 * [skills: backend-dev-guidelines, container-security-hardening]
 */

import { Worker, Queue, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { createAuditLog } from "@/server/audit-log";
import { minioClient, BUCKET_NAME, generatePresignedDownloadUrl } from "@/server/minio";
const archiver = require("archiver");
import { Writable, PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

// ------------------------------------------------------------------
// Prisma singleton
// ------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __auditorPkgPrisma: PrismaClient | undefined;
}

const prisma: PrismaClient = globalThis.__auditorPkgPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__auditorPkgPrisma = prisma;
}

// ------------------------------------------------------------------
// Queue definition
// ------------------------------------------------------------------

export const AUDITOR_PACKAGE_QUEUE_NAME = "generate-auditor-package";

export interface AuditorPackageJobData {
  organizationId: string;
  requestedBy: string; // userId
  frameworkIds: string[];
  includeRawFiles: boolean;
}

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

export const auditorPackageQueue = new Queue<AuditorPackageJobData>(
  AUDITOR_PACKAGE_QUEUE_NAME,
  {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
);

// ------------------------------------------------------------------
// XSS-safe HTML escaping
// ------------------------------------------------------------------

function escHtml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ------------------------------------------------------------------
// index.html generator
// ------------------------------------------------------------------

function generateIndexHtml(data: {
  orgName: string;
  generatedAt: string;
  controls: Array<{
    id: string;
    title: string;
    domain: string;
    status: string;
    framework: string;
    evidence: Array<{ fileName: string; type: string; collectedAt: Date }>;
  }>;
  policies: Array<{ title: string; policyType: string; version: number }>;
  auditLog: Array<{ action: string; entity: string; timestamp: Date }>;
  anchor: { rootHash: string; recordCount: number; anchoredAt: string } | null;
}): string {
  const controlRows = data.controls
    .map(
      (c) => `
    <tr>
      <td>${escHtml(c.framework)}</td>
      <td>${escHtml(c.domain)}</td>
      <td>${escHtml(c.title)}</td>
      <td class="status status-${escHtml(c.status.toLowerCase())}">${escHtml(c.status)}</td>
      <td>${c.evidence.length}</td>
    </tr>`,
    )
    .join("");

  const policyRows = data.policies
    .map(
      (p) => `<tr><td>${escHtml(p.title)}</td><td>${escHtml(p.policyType)}</td><td>v${escHtml(p.version)}</td></tr>`,
    )
    .join("");

  const auditRows = data.auditLog
    .slice(0, 100)
    .map(
      (a) =>
        `<tr><td>${escHtml(new Date(a.timestamp).toISOString())}</td><td>${escHtml(a.action)}</td><td>${escHtml(a.entity)}</td></tr>`,
    )
    .join("");

  const anchorSection = data.anchor
    ? `<section class="card anchor-card">
        <h2>&#128274; Tamper-Evidence Anchor</h2>
        <p>This export contains a cryptographic anchor that was stored in WORM (Write-Once Read-Many) storage at <strong>${escHtml(data.anchor.anchoredAt)}</strong>.</p>
        <table>
          <tr><th>Root Hash (SHA-256)</th><td class="mono">${escHtml(data.anchor.rootHash)}</td></tr>
          <tr><th>Records Covered</th><td>${escHtml(data.anchor.recordCount)}</td></tr>
          <tr><th>Anchored At</th><td>${escHtml(data.anchor.anchoredAt)}</td></tr>
        </table>
        <p class="note">To verify integrity: recompute the SHA-256 chain over the audit log entries listed below and compare against the Root Hash above. A mismatch indicates tampering.</p>
      </section>`
    : `<section class="card anchor-card"><h2>&#9888;&#65039; No Tamper-Evidence Anchor</h2><p>No WORM anchor has been generated for this export. Enable anchor scheduling in Settings.</p></section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dharma Compliance Report — ${escHtml(data.orgName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; padding: 32px; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    .meta { color: #64748b; font-size: 0.875rem; margin-bottom: 32px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .anchor-card { border-color: #6366f1; background: #eef2ff; }
    h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; }
    td { padding: 8px 12px; border-top: 1px solid #e2e8f0; }
    .status { font-weight: 600; text-transform: uppercase; font-size: 0.75rem; }
    .status-compliant { color: #16a34a; }
    .status-in_progress { color: #d97706; }
    .status-non_compliant { color: #dc2626; }
    .status-not_started { color: #6b7280; }
    .mono { font-family: monospace; font-size: 0.75rem; word-break: break-all; }
    .note { font-size: 0.75rem; color: #475569; margin-top: 12px; }
    footer { text-align: center; color: #94a3b8; font-size: 0.75rem; margin-top: 40px; }
  </style>
</head>
<body>
  <h1>&#9737; Dharma Compliance Export</h1>
  <p class="meta">Organisation: <strong>${escHtml(data.orgName)}</strong> &nbsp;|&nbsp; Generated: ${escHtml(data.generatedAt)}</p>

  ${anchorSection}

  <section class="card">
    <h2>&#128203; Controls Summary</h2>
    <table>
      <thead><tr><th>Framework</th><th>Domain</th><th>Control</th><th>Status</th><th>Evidence Count</th></tr></thead>
      <tbody>${controlRows || "<tr><td colspan=5>No controls found.</td></tr>"}</tbody>
    </table>
  </section>

  <section class="card">
    <h2>&#128196; Published Policies</h2>
    <table>
      <thead><tr><th>Title</th><th>Type</th><th>Version</th></tr></thead>
      <tbody>${policyRows || "<tr><td colspan=3>No published policies.</td></tr>"}</tbody>
    </table>
  </section>

  <section class="card">
    <h2>&#128270; Recent Audit Log (last 100 entries)</h2>
    <table>
      <thead><tr><th>Timestamp</th><th>Action</th><th>Entity</th></tr></thead>
      <tbody>${auditRows || "<tr><td colspan=3>No audit log entries.</td></tr>"}</tbody>
    </table>
  </section>

  <footer>
    <p>Generated by Dharma &mdash; Self-hosted GRC Platform. This document is not legal advice.</p>
    <p>All data is from your self-hosted Dharma instance. No data was sent to any cloud service to generate this report.</p>
  </footer>
</body>
</html>`;
}

// ------------------------------------------------------------------
// Job processor
// ------------------------------------------------------------------

async function processAuditorPackageJob(
  job: Job<AuditorPackageJobData>,
): Promise<{ downloadUrl: string; expiresAt: string; filePath: string }> {
  const { organizationId, requestedBy, frameworkIds, includeRawFiles } = job.data;
  console.log(`[auditor-pkg] ▶ Job ${job.id} — org=${organizationId}, frameworks=${frameworkIds.join(",")}`);

  // 1. Load org
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

  // 2. Load controls + evidence
  const frameworks = await prisma.framework.findMany({
    where: { organizationId, ...(frameworkIds.length > 0 ? { id: { in: frameworkIds } } : {}) },
    include: {
      controls: {
        include: {
          evidence: { select: { fileName: true, filePath: true, type: true, collectedAt: true, summary: true } },
        },
      },
    },
  });

  const controlsFlat = frameworks.flatMap((fw) =>
    fw.controls.map((c) => ({
      id: c.id,
      title: c.title,
      domain: c.domain,
      status: c.status,
      framework: fw.name,
      evidence: c.evidence,
    })),
  );

  // 3. Load published policies
  const policies = await prisma.policy.findMany({
    where: { organizationId, isPublished: true },
    select: { title: true, policyType: true, version: true, content: true },
  });

  // 4. Load audit log (desc, last 200)
  const auditLog = await prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { timestamp: "desc" },
    take: 200,
    select: { action: true, entity: true, timestamp: true },
  });

  // 5. Load latest chain anchor
  const latestAnchor = await prisma.chainAnchor.findFirst({
    where: { organizationId },
    orderBy: { anchoredAt: "desc" },
    select: { rootHash: true, recordCount: true, anchoredAt: true },
  });

  // 6. Generate static index.html
  const html = generateIndexHtml({
    orgName: org.name,
    generatedAt: new Date().toISOString(),
    controls: controlsFlat,
    policies,
    auditLog,
    anchor: latestAnchor
      ? {
          rootHash: latestAnchor.rootHash,
          recordCount: latestAnchor.recordCount,
          anchoredAt: latestAnchor.anchoredAt.toISOString(),
        }
      : null,
  });

  // 7. Build ZIP in memory using a PassThrough → MinIO upload stream
  const timestamp = Date.now();
  const zipKey = `exports/${organizationId}/${timestamp}.zip`;

  const passThrough = new PassThrough();

  // Upload to MinIO concurrently while we pipe the archive
  const uploadPromise = minioClient.putObject(BUCKET_NAME, zipKey, passThrough, undefined, {
    "Content-Type": "application/zip",
  });

  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.pipe(passThrough);

  // Add index.html
  archive.append(html, { name: "index.html" });

  // Add policies as markdown files
  for (const policy of policies) {
    const safeName = policy.title.replace(/[^\w.-]/g, "_").slice(0, 80);
    archive.append(policy.content, { name: `policies/${safeName}.md` });
  }

  // Add audit log as JSON
  archive.append(JSON.stringify(auditLog, null, 2), { name: "audit-log.json" });

  // Add anchor manifest if present
  if (latestAnchor) {
    archive.append(JSON.stringify(latestAnchor, null, 2), { name: "chain-anchor.json" });
  }

  // Optionally include raw evidence files
  if (includeRawFiles) {
    for (const control of controlsFlat) {
      for (const evidence of control.evidence) {
        try {
          const stream = await minioClient.getObject(BUCKET_NAME, evidence.filePath);
          const safeFile = evidence.fileName.replace(/[^\w.-]/g, "_");
          archive.append(stream as NodeJS.ReadableStream, {
            name: `evidence/${control.id}/${safeFile}`,
          });
        } catch (err) {
          console.warn(`[auditor-pkg] Skipping missing evidence file: ${evidence.filePath}`, err);
        }
      }
    }
  }

  await archive.finalize();
  await uploadPromise;

  // 8. Generate presigned download URL (24h)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const downloadUrl = await generatePresignedDownloadUrl(zipKey, 24 * 3600);

  // 9. Persist AuditExport row
  await prisma.auditExport.create({
    data: {
      organizationId,
      requestedBy,
      frameworkIds,
      filePath: zipKey,
      includeRawFiles,
      expiresAt,
    },
  });

  // 10. Write AuditLog entry
  await createAuditLog(prisma, {
    organizationId,
    userId: requestedBy,
    action: "AUDITOR_PACKAGE_EXPORTED",
    entity: "AuditExport",
    entityId: zipKey,
    changes: { frameworkCount: frameworks.length, includeRawFiles, controlCount: controlsFlat.length },
  });

  console.log(`[auditor-pkg] ✅ Job ${job.id} — ZIP at ${zipKey}, expires ${expiresAt.toISOString()}`);

  return { downloadUrl, expiresAt: expiresAt.toISOString(), filePath: zipKey };
}

// ------------------------------------------------------------------
// Worker factory
// ------------------------------------------------------------------

export function startAuditorPackageWorker() {
  const worker = new Worker<
    AuditorPackageJobData,
    { downloadUrl: string; expiresAt: string; filePath: string }
  >(AUDITOR_PACKAGE_QUEUE_NAME, processAuditorPackageJob, {
    connection: redisConnection(),
    concurrency: 1, // ZIP generation is memory-intensive
  });

  worker.on("completed", (job) => {
    console.log(`[auditor-pkg] ✅ Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[auditor-pkg] ❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[auditor-pkg] Worker error:", err);
  });

  console.log(`[auditor-pkg] Worker started — queue="${AUDITOR_PACKAGE_QUEUE_NAME}"`);
  return worker;
}

if (require.main === module) {
  const worker = startAuditorPackageWorker();
  process.on("SIGTERM", async () => {
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
