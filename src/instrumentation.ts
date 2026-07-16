/**
 * src/instrumentation.ts
 *
 * Next.js instrumentation hook (requires experimental.instrumentationHook in
 * next.config.js). Runs once when the Node.js server boots; the edge runtime
 * is excluded. OTel export only activates when OTEL_EXPORTER_OTLP_ENDPOINT
 * is set — see src/lib/observability/otel.ts.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOtel } = await import("@/lib/observability/otel");
    startOtel("dharma-app");
  }
}
