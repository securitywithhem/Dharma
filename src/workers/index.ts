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
import { startAuditVerificationWorker } from "@/server/queue/workers/auditVerificationWorker";
import { registerScheduledChainVerification } from "@/server/queue/auditVerificationQueue";
import { attachDeadLetterAlerting } from "@/server/lib/ops/alert";

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
// pair of jobs covers every subscribed org — no per-provider queues.
const dunningWorker = startDunningWorker();
const billingReconciliationWorker = startBillingReconciliationWorker();
// GH #26 — audit hash-chain verification, on demand and on a nightly schedule.
const auditVerificationWorker = startAuditVerificationWorker();

// ── Dead-letter alerting ────────────────────────────────────────────────────
// Each worker above already logs its own `failed` events, but only as free
// text on stdout — nothing distinguishes "retry 1 of 3 failed" from "this job
// is gone forever", so an embedding, report, or dunning job could give up
// permanently and nobody would know. attachDeadLetterAlerting adds a second
// listener (BullMQ allows many) that classifies terminal failures as CRITICAL
// and routes them to the ops alert channel. Attached centrally rather than in
// each worker module so a newly added worker is one line away from coverage
// and can't be forgotten.
// Typed as unknown[] on purpose: the entries are a union of BullMQ Workers and
// at least one `{ close }` shim, and TypeScript won't narrow that union
// through Array.filter. Widening here lets the isAlertable guard below do the
// narrowing properly instead of forcing a cast.
const allWorkers: unknown[] = [
  classificationWorker,
  // policyWorker is a composite over two queues (review + legacy drain), so
  // spread its underlying workers rather than the wrapper.
  ...policyWorker.workers,
  anchorWorker,
  connectorWorker,
  auditorPackageWorker,
  connectorEvidenceWorker,
  webhookWorker,
  controlEmbeddingWorker,
  readinessScoreWorker,
  aiIngestionWorker,
  evidenceAutoTagWorker,
  auditEventWorker,
  siemExportWorker,
  endpointCheckPostprocessWorker,
  endpointStaleSweepWorker,
  reportWorker,
  reportScheduleDispatchWorker,
  regulatoryFanoutWorker,
  // Billing workers are the highest-consequence entries in this list: a
  // dead-lettered dunning job leaves a delinquent org on a paid plan forever,
  // and a dead-lettered reconciliation job lets provider-side drift (a
  // cancellation we never saw) go uncorrected. Both fail silently otherwise.
  dunningWorker,
  billingReconciliationWorker,
  // A dead-lettered verification job leaves an AuditChainVerification row stuck
  // at RUNNING forever — which the UI renders as "still checking", i.e. as an
  // answer that is on its way rather than one that will never arrive.
  auditVerificationWorker,
];

// Not every entry above is a real BullMQ Worker — at least one start* function
// returns a bare `{ close }` shim with no event emitter. Narrow to the ones
// that can actually emit "failed" rather than casting, so a future shim is
// skipped instead of crashing the worker process on boot.
type AlertableWorker = Parameters<typeof attachDeadLetterAlerting>[0] & { name: string };

const isAlertable = (w: unknown): w is AlertableWorker =>
  typeof w === "object" &&
  w !== null &&
  typeof (w as { on?: unknown }).on === "function" &&
  typeof (w as { name?: unknown }).name === "string";

const alertableWorkers = allWorkers.filter(isAlertable);
for (const worker of alertableWorkers) {
  // BullMQ sets Worker.name to the queue name it consumes.
  attachDeadLetterAlerting(worker, worker.name);
}
console.log(
  `🔔 Dead-letter alerting attached to ${alertableWorkers.length}/${allWorkers.length} workers.`,
);
if (alertableWorkers.length !== allWorkers.length) {
  console.warn(
    `⚠️  ${allWorkers.length - alertableWorkers.length} worker(s) expose no "failed" event — ` +
      "their terminal failures are NOT alerted. See src/server/lib/ops/alert.ts.",
  );
}

void registerDailySweep();
void registerEndpointStaleSweep();
void registerReportScheduleDispatch();
void registerDunningSweep();
void registerBillingReconciliation();
void registerScheduledChainVerification();

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
