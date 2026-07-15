/**
 * Dispatch triggers for outgoing webhooks — called by the evidence
 * collection worker when auto-collected evidence lands or a control
 * transitions into a failing state. Enqueues one "webhook-delivery" job
 * per active, subscribed Webhook; the webhookWorker (Part 3) handles the
 * actual signed HTTP delivery on its own isolated queue.
 */
import type { PrismaClient } from "@prisma/client";
import { enqueueWebhookDelivery } from "@/server/queue/webhookQueue";

export const WEBHOOK_EVENT_EVIDENCE_UPDATED = "evidence.updated";
export const WEBHOOK_EVENT_CONTROL_FAILED = "control.failed";
// Phase 9 Part 3 — new event types. Additions to the existing dispatcher's
// event vocabulary, NOT a second dispatcher.
export const WEBHOOK_EVENT_REGULATORY_ALERT_CREATED = "regulatory.alert_created";
export const WEBHOOK_EVENT_EVIDENCE_CREATED = "evidence.created";

/** All event types an org can subscribe a webhook to (for UI + validation). */
export const WEBHOOK_EVENT_TYPES = [
  WEBHOOK_EVENT_EVIDENCE_UPDATED,
  WEBHOOK_EVENT_CONTROL_FAILED,
  WEBHOOK_EVENT_REGULATORY_ALERT_CREATED,
  WEBHOOK_EVENT_EVIDENCE_CREATED,
] as const;

export interface EvidenceUpdatedSummary {
  id: string;
  evidenceType: string;
  status: "pass" | "fail" | "unknown";
  collectedAt: Date;
}

/**
 * Enqueues an "evidence.updated" delivery to every active webhook in the org
 * subscribed to that event. Payload is intentionally minimal — no raw
 * credentials, no full evidence blob beyond what's already visible to the
 * org via the API.
 */
export async function notifyEvidenceUpdated(
  prisma: PrismaClient,
  organizationId: string,
  controlId: string,
  evidence: EvidenceUpdatedSummary,
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId,
      isActive: true,
      events: { has: WEBHOOK_EVENT_EVIDENCE_UPDATED },
    },
    select: { id: true },
  });

  for (const webhook of webhooks) {
    await enqueueWebhookDelivery({
      webhookId: webhook.id,
      event: WEBHOOK_EVENT_EVIDENCE_UPDATED,
      payload: {
        controlId,
        evidenceId: evidence.id,
        evidenceType: evidence.evidenceType,
        status: evidence.status,
        collectedAt: evidence.collectedAt.toISOString(),
      },
    });
  }
}

/**
 * Enqueues a "control.failed" delivery to every active webhook in the org
 * subscribed to that event. Callers MUST only invoke this on an actual
 * transition into a failing state (see connectorEvidenceWorker.ts, which
 * only calls this inside the `nextStatus !== control.status` guard) — a
 * control that was already failing must not re-fire this event on every
 * subsequent failing run.
 */
export async function notifyControlFailed(
  prisma: PrismaClient,
  organizationId: string,
  controlId: string,
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId,
      isActive: true,
      events: { has: WEBHOOK_EVENT_CONTROL_FAILED },
    },
    select: { id: true },
  });

  for (const webhook of webhooks) {
    await enqueueWebhookDelivery({
      webhookId: webhook.id,
      event: WEBHOOK_EVENT_CONTROL_FAILED,
      payload: { controlId, failedAt: new Date().toISOString() },
    });
  }
}

/**
 * Phase 9 Part 3 — enqueues a "regulatory.alert_created" delivery to every
 * active subscribed webhook in the org. Payload is minimal metadata (no full
 * diff blob — the org can fetch it via regulatory.listAlerts / the API).
 */
export async function notifyRegulatoryAlertCreated(
  prisma: PrismaClient,
  organizationId: string,
  alert: { id: string; frameworkVersionId: string; version: string },
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId,
      isActive: true,
      events: { has: WEBHOOK_EVENT_REGULATORY_ALERT_CREATED },
    },
    select: { id: true },
  });

  for (const webhook of webhooks) {
    await enqueueWebhookDelivery({
      webhookId: webhook.id,
      event: WEBHOOK_EVENT_REGULATORY_ALERT_CREATED,
      payload: {
        alertId: alert.id,
        frameworkVersionId: alert.frameworkVersionId,
        version: alert.version,
        createdAt: new Date().toISOString(),
      },
    });
  }
}

/**
 * Phase 9 Part 3 — enqueues an "evidence.created" delivery when a third party
 * pushes evidence via the public API. Same minimal-payload contract.
 */
export async function notifyEvidenceCreated(
  prisma: PrismaClient,
  organizationId: string,
  evidence: { id: string; controlId: string; evidenceType: string },
): Promise<void> {
  const webhooks = await prisma.webhook.findMany({
    where: {
      organizationId,
      isActive: true,
      events: { has: WEBHOOK_EVENT_EVIDENCE_CREATED },
    },
    select: { id: true },
  });

  for (const webhook of webhooks) {
    await enqueueWebhookDelivery({
      webhookId: webhook.id,
      event: WEBHOOK_EVENT_EVIDENCE_CREATED,
      payload: {
        evidenceId: evidence.id,
        controlId: evidence.controlId,
        evidenceType: evidence.evidenceType,
        source: "api",
        createdAt: new Date().toISOString(),
      },
    });
  }
}
