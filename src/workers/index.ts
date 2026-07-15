/**
 * src/workers/index.ts
 *
 * Dharma background worker entry-point.
 * Starts all BullMQ workers in a single process.
 *
 * Phase 2: adds anchor-chain, connector-sync, review-policy-draft,
 *          and generate-auditor-package workers.
 */

import { startClassificationWorker } from "./classification";
import { startPolicyWorker } from "./policy";
import { startAnchorWorker } from "./anchor";
import { startConnectorWorker } from "./connectors/index";
import { startAuditorPackageWorker } from "./auditorPackage";
import { startConnectorEvidenceWorker } from "@/server/queue/workers/connectorEvidenceWorker";
import { startWebhookWorker } from "@/server/queue/workers/webhookWorker";
import { startControlEmbeddingWorker } from "@/server/queue/workers/controlEmbeddingWorker";
import { startReadinessScoreWorker, registerDailySweep } from "@/server/queue/workers/readinessScoreWorker";
import { startAiIngestionWorker } from "@/server/queue/workers/aiIngestionWorker";
import { startEvidenceAutoTagWorker } from "@/server/queue/workers/evidenceAutoTagWorker";
import { startAuditEventWorker } from "@/server/queue/workers/auditEventWorker";
import { startSiemExportWorker } from "@/server/queue/workers/siemExportWorker";

console.log("🚀 Starting Dharma background workers...");

const classificationWorker = startClassificationWorker();
const policyWorker = startPolicyWorker();
const anchorWorker = startAnchorWorker();
const connectorWorker = startConnectorWorker();
const auditorPackageWorker = startAuditorPackageWorker();
const connectorEvidenceWorker = startConnectorEvidenceWorker();
const webhookWorker = startWebhookWorker();
const controlEmbeddingWorker = startControlEmbeddingWorker();
const readinessScoreWorker = startReadinessScoreWorker();
const aiIngestionWorker = startAiIngestionWorker();
const evidenceAutoTagWorker = startEvidenceAutoTagWorker();
// Phase 8 Part 2 — async audit writer + SIEM export
const auditEventWorker = startAuditEventWorker();
const siemExportWorker = startSiemExportWorker();
void registerDailySweep();

process.on("SIGTERM", async () => {
  console.log("SIGTERM received — draining workers...");
  await Promise.all([
    classificationWorker.close(),
    policyWorker.close(),
    anchorWorker.close(),
    connectorWorker.close(),
    auditorPackageWorker.close(),
    connectorEvidenceWorker.close(),
    webhookWorker.close(),
    controlEmbeddingWorker.close(),
    readinessScoreWorker.close(),
    aiIngestionWorker.close(),
    evidenceAutoTagWorker.close(),
    auditEventWorker.close(),
    siemExportWorker.close(),
  ]);
  process.exit(0);
});
