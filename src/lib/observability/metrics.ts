/**
 * src/lib/observability/metrics.ts
 *
 * Custom application metrics, defined via @opentelemetry/api.
 *
 * Instruments are created LAZILY on first record/add: unlike traces, the OTel
 * metrics API has no proxy provider, so an instrument created at module-import
 * time (before NodeSDK.start() registers the global MeterProvider) would stay
 * bound to the no-op meter forever. Lazy creation also means that when export
 * is disabled (OTEL_EXPORTER_OTLP_ENDPOINT unset — dev, tests) every call is a
 * free no-op and call sites need no guards.
 */

import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type MetricOptions,
} from "@opentelemetry/api";

import { isOtelEnabled } from "./otel";

// Only cache the instrument once export is enabled (i.e. the real SDK is the
// global provider); otherwise a call racing SDK startup would pin the no-op.
function lazyHistogram(name: string, options: MetricOptions) {
  let instrument: Histogram | undefined;
  return {
    record(value: number, attributes?: Attributes): void {
      const inst =
        instrument ?? metrics.getMeter("dharma").createHistogram(name, options);
      if (!instrument && isOtelEnabled()) instrument = inst;
      inst.record(value, attributes);
    },
  };
}

function lazyCounter(name: string, options: MetricOptions) {
  let instrument: Counter | undefined;
  return {
    add(value: number, attributes?: Attributes): void {
      const inst =
        instrument ?? metrics.getMeter("dharma").createCounter(name, options);
      if (!instrument && isOtelEnabled()) instrument = inst;
      inst.add(value, attributes);
    },
  };
}

/** Duration of tRPC procedure calls, labelled { path, type, status }. */
export const trpcRequestDuration = lazyHistogram("trpc_request_duration_ms", {
  description: "tRPC procedure duration in milliseconds",
  unit: "ms",
});

/** BullMQ jobs completed/failed, labelled { queue, status }. */
export const queueJobsProcessed = lazyCounter("queue_jobs_processed_total", {
  description: "Total BullMQ jobs processed",
});

/** BullMQ job processing duration, labelled { queue }. */
export const queueJobDuration = lazyHistogram("queue_job_duration_ms", {
  description: "BullMQ job processing duration in milliseconds",
  unit: "ms",
});

/** Authentication attempts, labelled { method, status }. */
export const authAttempts = lazyCounter("auth_attempts_total", {
  description: "Total authentication attempts",
});
