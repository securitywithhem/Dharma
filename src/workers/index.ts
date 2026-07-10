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

console.log("🚀 Starting Dharma background workers...");

const classificationWorker = startClassificationWorker();
const policyWorker = startPolicyWorker();
const anchorWorker = startAnchorWorker();
const connectorWorker = startConnectorWorker();
const auditorPackageWorker = startAuditorPackageWorker();
const connectorEvidenceWorker = startConnectorEvidenceWorker();
const webhookWorker = startWebhookWorker();

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
  ]);
  process.exit(0);
});
