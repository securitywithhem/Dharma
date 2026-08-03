/**
 * src/workers/index.ts
 *
 * Dharma background worker entry-point.
 * Starts all BullMQ workers in a single process.
 *
 * Phase 2: adds anchor-chain, connector-sync, review-policy-draft,
 *          and generate-auditor-package workers.
 */

// Must stay the first import: starts OTel before bullmq/ioredis/pg load so
// auto-instrumentation can patch them. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT.
import "./instrumentation";
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
import { startEndpointCheckPostprocessWorker } from "@/server/queue/workers/endpointCheckPostprocessWorker";
import { startEndpointStaleSweepWorker } from "@/server/queue/workers/endpointStaleSweepWorker";
import { registerEndpointStaleSweep } from "@/server/queue/endpointQueue";
import { startReportWorker } from "@/server/queue/workers/reportWorker";
import { startReportScheduleDispatchWorker } from "@/server/queue/workers/reportScheduleDispatchWorker";
import { registerReportScheduleDispatch } from "@/server/queue/reportQueue";
import { startRegulatoryFanoutWorker } from "@/server/queue/workers/regulatoryFanoutWorker";
import { startDunningWorker } from "@/server/queue/workers/dunningWorker";
import { registerDunningSweep } from "@/server/queue/dunningQueue";
import { startBillingReconciliationWorker } from "@/server/queue/workers/billingReconciliationWorker";
import { registerBillingReconciliation } from "@/server/queue/billingReconciliationQueue";

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
// Phase 9 Part 1 — endpoint agent (EDR-lite)
const endpointCheckPostprocessWorker = startEndpointCheckPostprocessWorker();
const endpointStaleSweepWorker = startEndpointStaleSweepWorker();
// Phase 9 Part 2 — advanced reporting
const reportWorker = startReportWorker();
const reportScheduleDispatchWorker = startReportScheduleDispatchWorker();
// Phase 9 Part 3 — regulatory change monitoring fanout
const regulatoryFanoutWorker = startRegulatoryFanoutWorker();
// Phase 3b/3c — billing lifecycle: dunning + payment-provider drift
// reconciliation. Both workers resolve the adapter per organization, so one
// pair of jobs covers Razorpay and Stripe orgs alike — no new queues.
const dunningWorker = startDunningWorker();
const billingReconciliationWorker = startBillingReconciliationWorker();
void registerDailySweep();
void registerEndpointStaleSweep();
void registerReportScheduleDispatch();
void registerDunningSweep();
void registerBillingReconciliation();

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
    endpointCheckPostprocessWorker.close(),
    endpointStaleSweepWorker.close(),
    reportWorker.close(),
    reportScheduleDispatchWorker.close(),
    regulatoryFanoutWorker.close(),
    dunningWorker.close(),
    billingReconciliationWorker.close(),
  ]);
  process.exit(0);
});
