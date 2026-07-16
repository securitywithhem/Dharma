/**
 * src/workers/instrumentation.ts
 *
 * Starts OpenTelemetry for the worker process. This module is imported FIRST
 * in src/workers/index.ts so the SDK's auto-instrumentation patches load
 * before ioredis/bullmq/pg are pulled in by the worker modules.
 */

import { startOtel } from "@/lib/observability/otel";

startOtel("dharma-worker");
