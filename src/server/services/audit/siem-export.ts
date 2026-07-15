// Phase 8 Part 2 — SIEM export (PRD: "Audit logs … exportable to SIEM").
// Two transports: Splunk HTTP Event Collector, and RFC 5424 syslog
// (UDP or TCP) for QRadar/generic receivers.
//
// Security notes:
// - The HEC token is stored encrypted (siemVault) and is decrypted only at
//   send time; it is never logged and never included in error messages.
// - Exported events carry the audit row fields (actor id, action, entity,
//   changes) — that is the product's contract with the org's own SIEM.
import { createConnection } from "node:net";
import { createSocket } from "node:dgram";
import { z } from "zod";
import type { AuditLog } from "@prisma/client";
import { decryptSiemSecret } from "@/server/lib/crypto/siemVault";

export const splunkHecConfigSchema = z.object({
  type: z.literal("splunk-hec"),
  /** Collector base URL, e.g. https://splunk.example.com:8088 */
  url: z.string().url(),
  /** AES-256-GCM envelope of the HEC token (siemVault). */
  tokenEnc: z.string().min(1),
  index: z.string().optional(),
  sourcetype: z.string().default("dharma:audit"),
});

export const syslogConfigSchema = z.object({
  type: z.literal("syslog"),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(514),
  protocol: z.enum(["udp", "tcp"]).default("udp"),
});

export const siemExportConfigSchema = z.discriminatedUnion("type", [
  splunkHecConfigSchema,
  syslogConfigSchema,
]);

export type SiemExportConfig = z.infer<typeof siemExportConfigSchema>;

export function parseStoredSiemConfig(value: unknown): SiemExportConfig | null {
  const parsed = siemExportConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type SiemAuditEvent = Pick<
  AuditLog,
  "id" | "organizationId" | "userId" | "action" | "entity" | "entityId" | "changes"
> & { timestamp: Date | string };

function eventBody(event: SiemAuditEvent) {
  return {
    auditLogId: event.id,
    organizationId: event.organizationId,
    actorId: event.userId ?? "system",
    action: event.action,
    entity: event.entity,
    entityId: event.entityId,
    changes: event.changes ?? null,
    timestamp: new Date(event.timestamp).toISOString(),
  };
}

export async function exportToSplunkHec(
  event: SiemAuditEvent,
  config: z.infer<typeof splunkHecConfigSchema>,
): Promise<void> {
  const token = decryptSiemSecret<string>(config.tokenEnc);
  const response = await fetch(`${config.url.replace(/\/$/, "")}/services/collector/event`, {
    method: "POST",
    headers: {
      authorization: `Splunk ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      time: new Date(event.timestamp).getTime() / 1000,
      host: "dharma",
      source: "dharma-audit",
      sourcetype: config.sourcetype,
      ...(config.index ? { index: config.index } : {}),
      event: eventBody(event),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Body may echo the request (which never contains the token) — safe to
    // truncate into the error for the failed-job log.
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Splunk HEC returned HTTP ${response.status}: ${detail}`);
  }
}

/** RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG */
export function formatRfc5424(event: SiemAuditEvent): string {
  const pri = 14 * 8 + 6; // facility 14 (log audit), severity 6 (informational)
  const timestamp = new Date(event.timestamp).toISOString();
  return `<${pri}>1 ${timestamp} dharma audit - ${event.id} - ${JSON.stringify(eventBody(event))}`;
}

export async function exportToSyslog(
  event: SiemAuditEvent,
  config: z.infer<typeof syslogConfigSchema>,
): Promise<void> {
  const message = Buffer.from(formatRfc5424(event), "utf8");

  if (config.protocol === "udp") {
    await new Promise<void>((resolve, reject) => {
      const socket = createSocket("udp4");
      socket.send(message, config.port, config.host, (error) => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: config.host, port: config.port }, () => {
      // RFC 6587 octet counting framing for TCP syslog.
      socket.write(`${message.length} `, (headerError) => {
        if (headerError) {
          socket.destroy();
          reject(headerError);
          return;
        }
        socket.end(message, () => resolve());
      });
    });
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("syslog TCP connection timed out"));
    });
    socket.on("error", reject);
  });
}

export async function exportAuditEvent(
  event: SiemAuditEvent,
  config: SiemExportConfig,
): Promise<void> {
  if (config.type === "splunk-hec") {
    await exportToSplunkHec(event, config);
  } else {
    await exportToSyslog(event, config);
  }
}
