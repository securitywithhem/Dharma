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
