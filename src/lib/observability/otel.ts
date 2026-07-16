/**
 * src/lib/observability/otel.ts
 *
 * OpenTelemetry bootstrap shared by the Next.js server (via
 * src/instrumentation.ts) and the BullMQ worker (via
 * src/workers/instrumentation.ts).
 *
 * Exporting is OPT-IN: if OTEL_EXPORTER_OTLP_ENDPOINT is not set, no SDK is
 * started and every metric/trace call in the codebase degrades to the
 * @opentelemetry/api no-op implementations — zero overhead in dev and tests.
 *
 * Env vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT  e.g. http://otel-collector:4318 (enables export)
 *   OTEL_SERVICE_NAME            overrides the serviceName argument
 *   OTEL_METRIC_EXPORT_INTERVAL  ms between metric pushes (default 30000)
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { logger } from "@/lib/logger";

let sdk: NodeSDK | undefined;

export function isOtelEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

/**
 * Start the OpenTelemetry NodeSDK. Safe to call more than once (subsequent
 * calls are no-ops) and safe to call when export is disabled.
 */
export function startOtel(serviceName: string): void {
  if (sdk || !isOtelEnabled()) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, "");
  const exportIntervalMillis = Number(
    process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 30_000,
  );

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? serviceName,
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is extremely noisy under Next.js
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    logger.info(
      { endpoint, service: serviceName },
      "OpenTelemetry SDK started",
    );
  } catch (err) {
    // Observability must never take the app down.
    sdk = undefined;
    logger.error({ err }, "Failed to start OpenTelemetry SDK");
    return;
  }

  const shutdown = () => {
    void sdk
      ?.shutdown()
      .catch((err) => logger.error({ err }, "OTel shutdown failed"));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
