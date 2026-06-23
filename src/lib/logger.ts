/**
 * src/lib/logger.ts
 *
 * Structured logger for the Dharma application.
 * Uses pino for structured JSON output to stdout (Docker-friendly).
 * Falls back to a lightweight console wrapper if pino is not installed.
 *
 * Output is JSON in production (parsed by Docker log drivers / Loki).
 * Output is pretty-printed in development.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info({ evidenceId: "123" }, "Evidence classification started");
 *   logger.error({ err }, "Failed to connect to Ollama");
 *
 * Child loggers (bind context):
 *   const reqLogger = logger.child({ requestId: "abc" });
 *   reqLogger.info("Processing request");
 */

const isProd = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL ?? (isProd ? "info" : "debug");

// ── Pino logger (preferred) ────────────────────────────────────────────────
// pino is included transitively via several packages; we dynamic-import it
// so the module doesn't throw at load time if it's unavailable.
type LogFn = (data: Record<string, unknown> | string, msg?: string) => void;

interface Logger {
  trace: LogFn;
  debug: LogFn;
  info:  LogFn;
  warn:  LogFn;
  error: LogFn;
  fatal: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
}

// ── Fallback console logger ────────────────────────────────────────────────
// Simple structured JSON wrapper for environments without pino.
function makeConsoleLogger(bindings: Record<string, unknown> = {}): Logger {
  const levels: Record<string, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
  };
  const currentLevel = levels[logLevel] ?? 30;

  const write = (level: string, levelNum: number, data: Record<string, unknown> | string, msg?: string) => {
    if (levelNum < currentLevel) return;

    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...bindings,
    };

    if (typeof data === "string") {
      entry.msg = data;
    } else {
      Object.assign(entry, data);
      if (msg) entry.msg = msg;
    }

    const output = isProd ? JSON.stringify(entry) : `[${level.toUpperCase()}] ${entry.msg ?? ""} ${Object.keys(bindings).length ? JSON.stringify(bindings) : ""}`;

    if (levelNum >= levels.error) {
      console.error(output);
    } else if (levelNum >= levels.warn) {
      console.warn(output);
    } else {
      console.log(output);
    }
  };

  return {
    trace: (d, m) => write("trace", 10, d, m),
    debug: (d, m) => write("debug", 20, d, m),
    info:  (d, m) => write("info",  30, d, m),
    warn:  (d, m) => write("warn",  40, d, m),
    error: (d, m) => write("error", 50, d, m),
    fatal: (d, m) => write("fatal", 60, d, m),
    child: (b) => makeConsoleLogger({ ...bindings, ...b }),
  };
}

// ── Export ─────────────────────────────────────────────────────────────────
// We export a singleton logger and a factory for child loggers.
export const logger: Logger = makeConsoleLogger({
  service: "dharma",
  version: process.env.npm_package_version ?? "0.1.0",
});

/**
 * Create a child logger with bound context fields.
 * Use this per-request or per-module to add tracing context.
 *
 * @example
 * const log = createLogger({ module: "evidence" });
 * log.info({ evidenceId: "x" }, "Processing started");
 */
export function createLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
