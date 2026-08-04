/**
 * src/server/lib/ops/alert.ts
 *
 * Operational alerting for failures that no customer will report for us.
 *
 * This is deliberately NOT src/server/connectors/notify.ts. That module sends
 * customer-facing webhooks about *their* compliance events. This one is for
 * *us*: a queue that is dead-lettering, a payment webhook that is rejecting
 * events, a backup that did not run. Different audience, different urgency,
 * different destination.
 *
 * Scope is intentionally small. The goal is "we find out within minutes",
 * not an observability product:
 *   1. A structured CRITICAL/WARN line on stdout. docker-compose already
 *      captures stdout to json-file with rotation, and the Promtail/Grafana
 *      stack can select on `"level":"CRITICAL"` without any code change.
 *   2. An optional POST to OPS_ALERT_WEBHOOK_URL (Slack/Discord/ntfy incoming
 *      webhook — all free tiers), for the alerts that must page a human.
 *
 * No Sentry SDK: see claude/infra-audit-2026-08-04.md. Sentry's free tier
 * would work, but it needs an account and a DSN this environment doesn't
 * have, and wiring a half-configured SDK produces the illusion of monitoring
 * rather than monitoring. The webhook hook below is the integration point if
 * and when that account exists.
 */

export type AlertSeverity = "CRITICAL" | "WARN";

export interface OpsAlert {
  /** Stable, greppable identifier, e.g. "billing.webhook.signature_invalid". */
  event: string;
  severity: AlertSeverity;
  message: string;
  /** Any additional context. MUST NOT contain secrets or raw request bodies. */
  context?: Record<string, unknown>;
}

const WEBHOOK_URL = process.env.OPS_ALERT_WEBHOOK_URL ?? "";
const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Fire an operational alert.
 *
 * Never throws and never rejects: this is called from catch blocks and from
 * BullMQ event handlers, where an alerting failure must not become a second,
 * louder failure that masks the first. Delivery problems are logged and
 * swallowed.
 */
export async function opsAlert(alert: OpsAlert): Promise<void> {
  const record = {
    level: alert.severity,
    event: alert.event,
    message: alert.message,
    ...(alert.context ? { context: alert.context } : {}),
    timestamp: new Date().toISOString(),
  };

  // Single-line JSON so log processors can parse it without a multiline rule.
  const line = JSON.stringify(record);
  if (alert.severity === "CRITICAL") {
    console.error(line);
  } else {
    console.warn(line);
  }

  if (!WEBHOOK_URL) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `[${alert.severity}] ${alert.event}: ${alert.message}`,
          ...record,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Deliberately only a log: see the "never throws" contract above.
    console.error(
      JSON.stringify({
        level: "WARN",
        event: "ops.alert.delivery_failed",
        message: `Could not deliver ops alert for ${alert.event}`,
        context: { reason: err instanceof Error ? err.message : String(err) },
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

/**
 * Attach dead-letter alerting to a BullMQ worker.
 *
 * BullMQ retries a job per its backoff policy and only emits the terminal
 * `failed` event once attempts are exhausted — that terminal state is what we
 * alert on. Intermediate retries stay at WARN so a flaky network blip doesn't
 * page anyone, but an embedding/report/dunning job that has genuinely given
 * up does.
 */
export function attachDeadLetterAlerting(
  worker: {
    name?: string;
    on: (
      event: "failed",
      cb: (
        job: { id?: string; name?: string; attemptsMade?: number; opts?: { attempts?: number } } | undefined,
        err: Error,
      ) => void,
    ) => unknown;
  },
  queueName: string,
): void {
  worker.on("failed", (job, err) => {
    const attemptsMade = job?.attemptsMade ?? 0;
    const maxAttempts = job?.opts?.attempts ?? 1;
    const exhausted = attemptsMade >= maxAttempts;

    void opsAlert({
      event: exhausted ? `queue.${queueName}.dead_letter` : `queue.${queueName}.attempt_failed`,
      severity: exhausted ? "CRITICAL" : "WARN",
      message: exhausted
        ? `Job ${job?.name ?? "unknown"} (${job?.id ?? "?"}) on "${queueName}" failed permanently after ${attemptsMade} attempt(s): ${err.message}`
        : `Job ${job?.name ?? "unknown"} (${job?.id ?? "?"}) on "${queueName}" failed attempt ${attemptsMade}/${maxAttempts}: ${err.message}`,
      context: { queue: queueName, jobId: job?.id, jobName: job?.name, attemptsMade, maxAttempts },
    });
  });
}
