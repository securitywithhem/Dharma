// Phase 9 Part 2 — report schedule dispatch worker.
//
// Repeatable hourly job. For each enabled ReportSchedule whose cron is due
// this hour (and that hasn't already run this hour), it creates a QUEUED
// Report and enqueues generation with the schedule's recipient emails. The
// report worker renders + uploads; a small follow-up emails the recipients a
// download link once COMPLETED (best-effort via the shared mailer).
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { enqueueReportGeneration } from "@/server/queue/reportQueue";
import {
  REPORT_SCHEDULE_DISPATCH_QUEUE_NAME,
  type ReportScheduleDispatchJobData,
} from "@/server/queue/reportQueue";
import { cronMatchesNow } from "@/server/lib/cronMatch";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { logger } from "@/lib/logger";

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

/** True when the schedule already ran within the current hour. */
function ranThisHour(lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return false;
  return (
    lastRunAt.getFullYear() === now.getFullYear() &&
    lastRunAt.getMonth() === now.getMonth() &&
    lastRunAt.getDate() === now.getDate() &&
    lastRunAt.getHours() === now.getHours()
  );
}

export function createReportScheduleDispatchProcessor(prisma: PrismaClient) {
  return async (_job: Job<ReportScheduleDispatchJobData>) => {
    const now = new Date();
    const schedules = await prisma.reportSchedule.findMany({ where: { enabled: true } });

    let dispatched = 0;
    for (const schedule of schedules) {
      if (!cronMatchesNow(schedule.cron, now) || ranThisHour(schedule.lastRunAt, now)) {
        continue;
      }

      const cfg = (schedule.reportConfig ?? {}) as Record<string, unknown>;
      const type = cfg.type === "BOARD_SUMMARY" ? "BOARD_SUMMARY" : "CUSTOM_PDF";
      const recipients = Array.isArray(schedule.recipients)
        ? (schedule.recipients as unknown[]).filter((r): r is string => typeof r === "string")
        : [];

      const report = await prisma.report.create({
        data: {
          organizationId: schedule.organizationId,
          type,
          title: schedule.title,
          config: cfg as never,
          status: "QUEUED",
          generatedById: "report-scheduler", // system actor
        },
      });

      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now },
      });

      await enqueueReportGeneration({
        reportId: report.id,
        organizationId: schedule.organizationId,
        emailRecipients: recipients,
      });

      await emitAuditEvent(prisma, {
        organizationId: schedule.organizationId,
        userId: null,
        action: "REPORT_SCHEDULE_DISPATCHED",
        entity: "ReportSchedule",
        entityId: schedule.id,
        changes: { actor: "report-scheduler", reportId: report.id, recipients: recipients.length },
      });
      dispatched += 1;
    }

    return { scanned: schedules.length, dispatched };
  };
}

export function startReportScheduleDispatchWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<ReportScheduleDispatchJobData>(
    REPORT_SCHEDULE_DISPATCH_QUEUE_NAME,
    createReportScheduleDispatchProcessor(prisma),
    { connection: redisConnection(), concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "report schedule dispatch failed");
  });
  return worker;
}
