// Phase 9 Part 2 — report generation queues.
//
// PDF/board-summary generation is long-running (Prisma aggregation + PDF
// render, or graph extraction + LLM narration), so it MUST run off the
// request thread (2_TRD.md: async/event-driven for long-running tasks).
// Two queues, following the connector/webhook redisConnection() convention.
import { Queue } from "bullmq";
import { env } from "@/env";

export const REPORT_GENERATION_QUEUE_NAME = "report-generation";
export const REPORT_SCHEDULE_DISPATCH_QUEUE_NAME = "report-schedule-dispatch";

export interface ReportGenerationJobData {
  reportId: string;
  organizationId: string;
  /** When set, the completed report is emailed to these addresses (scheduled runs). */
  emailRecipients?: string[];
}

export interface ReportScheduleDispatchJobData {
  triggeredBy?: string;
}

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

let generationQueue: Queue<ReportGenerationJobData> | undefined;
let dispatchQueue: Queue<ReportScheduleDispatchJobData> | undefined;

/** Lazy so importing this from the router never opens Redis under jest. */
export function getReportGenerationQueue(): Queue<ReportGenerationJobData> {
  generationQueue ??= new Queue<ReportGenerationJobData>(REPORT_GENERATION_QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: {
      // PDF work is expensive; a couple of retries covers transient MinIO/LLM
      // hiccups without endlessly re-rendering.
      attempts: 3,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return generationQueue;
}

export function getReportScheduleDispatchQueue(): Queue<ReportScheduleDispatchJobData> {
  dispatchQueue ??= new Queue<ReportScheduleDispatchJobData>(
    REPORT_SCHEDULE_DISPATCH_QUEUE_NAME,
    {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    },
  );
  return dispatchQueue;
}

export async function enqueueReportGeneration(data: ReportGenerationJobData): Promise<void> {
  await getReportGenerationQueue().add("generate", data);
}

/** Registers the repeatable hourly schedule-dispatch scan (idempotent jobId). */
export async function registerReportScheduleDispatch(): Promise<void> {
  await getReportScheduleDispatchQueue().add(
    "dispatch",
    {},
    { jobId: "report-schedule-dispatch", repeat: { pattern: "0 * * * *" } },
  );
}
