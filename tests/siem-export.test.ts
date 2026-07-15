// Phase 8 Part 2 — SIEM export transport tests against REAL in-process
// receivers: an HTTP server standing in for Splunk HEC and a UDP socket for
// syslog. No mocks on the wire path.
import { describe, it, expect, afterAll } from "@jest/globals";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createSocket } from "node:dgram";
import {
  exportToSplunkHec,
  exportToSyslog,
  formatRfc5424,
  parseStoredSiemConfig,
  splunkHecConfigSchema,
} from "@/server/services/audit/siem-export";
import { encryptSiemSecret } from "@/server/lib/crypto/siemVault";

const sampleEvent = {
  id: "log-1",
  organizationId: "org-1",
  userId: "user-1",
  action: "CONTROL_UPDATED",
  entity: "Control",
  entityId: "ctl-9",
  changes: { status: "IMPLEMENTED" },
  timestamp: new Date("2026-07-13T10:00:00.000Z"),
};

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

function startHecMock(): Promise<{
  port: number;
  received: Array<{ auth: string | undefined; body: string }>;
  respondWith: { status: number };
}> {
  const received: Array<{ auth: string | undefined; body: string }> = [];
  const respondWith = { status: 200 };
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ auth: req.headers.authorization, body });
        res.statusCode = respondWith.status;
        res.end(JSON.stringify({ text: "ok", code: 0 }));
      });
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as { port: number }).port,
        received,
        respondWith,
      });
    });
  });
}

describe("Splunk HEC export", () => {
  it("POSTs the event with the decrypted token and never logs it in the payload", async () => {
    const hec = await startHecMock();
    const config = splunkHecConfigSchema.parse({
      type: "splunk-hec",
      url: `http://127.0.0.1:${hec.port}`,
      tokenEnc: encryptSiemSecret("super-secret-hec-token"),
      sourcetype: "dharma:audit",
    });

    await exportToSplunkHec(sampleEvent, config);

    expect(hec.received).toHaveLength(1);
    expect(hec.received[0].auth).toBe("Splunk super-secret-hec-token");
    const payload = JSON.parse(hec.received[0].body);
    expect(payload.sourcetype).toBe("dharma:audit");
    expect(payload.event.action).toBe("CONTROL_UPDATED");
    expect(payload.event.organizationId).toBe("org-1");
    // The token must never appear anywhere in the event body itself.
    expect(hec.received[0].body).not.toContain("super-secret-hec-token");
  });

  it("throws on a non-2xx HEC response so BullMQ retries", async () => {
    const hec = await startHecMock();
    hec.respondWith.status = 503;
    const config = splunkHecConfigSchema.parse({
      type: "splunk-hec",
      url: `http://127.0.0.1:${hec.port}`,
      tokenEnc: encryptSiemSecret("t"),
      sourcetype: "dharma:audit",
    });
    await expect(exportToSplunkHec(sampleEvent, config)).rejects.toThrow(/503/);
  });
});

describe("syslog export", () => {
  it("formats RFC 5424 with the audit payload as structured JSON", () => {
    const line = formatRfc5424(sampleEvent);
    expect(line).toMatch(/^<118>1 2026-07-13T10:00:00\.000Z dharma audit - log-1 - \{/);
    expect(JSON.parse(line.slice(line.indexOf("{")))).toMatchObject({
      action: "CONTROL_UPDATED",
      entityId: "ctl-9",
    });
  });

  it("delivers over UDP to a real socket", async () => {
    const socket = createSocket("udp4");
    const messages: string[] = [];
    await new Promise<void>((resolve) => {
      socket.on("message", (msg) => messages.push(msg.toString()));
      socket.bind(0, "127.0.0.1", resolve);
    });
    const port = (socket.address() as { port: number }).port;

    await exportToSyslog(sampleEvent, {
      type: "syslog",
      host: "127.0.0.1",
      port,
      protocol: "udp",
    });

    await new Promise((r) => setTimeout(r, 100));
    socket.close();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("CONTROL_UPDATED");
  });
});

describe("stored config parsing", () => {
  it("rejects malformed configs instead of exporting blindly", () => {
    expect(parseStoredSiemConfig({ type: "splunk-hec" })).toBeNull();
    expect(parseStoredSiemConfig(null)).toBeNull();
    expect(
      parseStoredSiemConfig({ type: "syslog", host: "s.test", port: 514, protocol: "udp" }),
    ).not.toBeNull();
  });
});
