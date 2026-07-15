// Phase 9 Part 2 — report-generation worker.
//
// Renders CUSTOM_PDF or BOARD_SUMMARY off the request thread, uploads the PDF
// to MinIO, and flips the Report row to COMPLETED (fileUrl = MinIO object key)
// or FAILED. On failure the raw error goes ONLY to the AuditLog metadata; the
// Report.errorMessage / UI sees a generic message.
import React from "react";
import { Worker, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { renderToBuffer } from "@react-pdf/renderer";
import { env } from "@/env";
import { prisma as sharedPrisma } from "@/server/db";
import { putObject, generatePresignedDownloadUrl } from "@/server/minio";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { sendMail } from "@/server/lib/mailer";
import {
  REPORT_GENERATION_QUEUE_NAME,
  type ReportGenerationJobData,
} from "@/server/queue/reportQueue";
import {
  buildCustomReportData,
  buildBoardSummary,
  type CustomReportConfig,
  type Narrator,
} from "@/server/services/reportData";
import { CustomReportDocument } from "@/lib/pdf/CustomReportDocument";
import { BoardSummaryDocument } from "@/lib/pdf/BoardSummaryDocument";
import type { ComplianceGraphConfig } from "@/server/lib/graphify/complianceGraphBuilder";
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

function graphConfigFromReport(config: {
  frameworkIds?: string[];
  from?: string | null;
  to?: string | null;
}): ComplianceGraphConfig {
  return {
    frameworkIds: config.frameworkIds,
    from: config.from ? new Date(config.from) : null,
    to: config.to ? new Date(config.to) : null,
  };
}

// `deps.narrate` is an optional testability seam for the board-summary LLM
// call (defaults to the real streaming client inside buildBoardSummary).
export function createReportProcessor(
  prisma: PrismaClient,
  deps: { narrate?: Narrator } = {},
) {
  return async (job: Job<ReportGenerationJobData>) => {
    const { reportId, organizationId, emailRecipients } = job.data;

    // Load the report ORG-SCOPED — the job payload's org must match the row.
    const report = await prisma.report.findFirst({
      where: { id: reportId, organizationId },
    });
    if (!report) {
      logger.warn({ reportId, organizationId }, "report-generation: row not found / wrong org");
      return;
    }

    await prisma.report.update({
      where: { id: report.id },
      data: { status: "GENERATING" },
    });

    try {
      const config = (report.config ?? {}) as Record<string, unknown>;
      let pdfBuffer: Buffer;

      if (report.type === "CUSTOM_PDF") {
        const customConfig: CustomReportConfig = {
          sections: (config.sections as CustomReportConfig["sections"]) ?? [],
          frameworkIds: config.frameworkIds as string[] | undefined,
          from: (config.from as string | null) ?? null,
          to: (config.to as string | null) ?? null,
        };
        const data = await buildCustomReportData(prisma, organizationId, customConfig);
        pdfBuffer = await renderToBuffer(
          React.createElement(CustomReportDocument, { data, title: report.title }) as never,
        );
      } else {
        // BOARD_SUMMARY
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { name: true },
        });
        const summary = await buildBoardSummary(
          prisma,
          organizationId,
          graphConfigFromReport(config as never),
          deps.narrate,
        );
        pdfBuffer = await renderToBuffer(
          React.createElement(BoardSummaryDocument, {
            title: report.title,
            organizationName: org.name,
            narrative: summary.narrative,
            overallReadiness: summary.overallReadiness,
            digest: summary.digest,
            generatedAt: new Date().toISOString(),
          }) as never,
        );
      }

      const objectKey = `${organizationId}/reports/${report.id}.pdf`;
      await putObject(objectKey, pdfBuffer, "application/pdf");

      await prisma.report.update({
        where: { id: report.id },
        data: { status: "COMPLETED", fileUrl: objectKey, completedAt: new Date(), errorMessage: null },
      });

      await emitAuditEvent(prisma, {
        organizationId,
        userId: report.generatedById,
        action: "REPORT_GENERATED",
        entity: "Report",
        entityId: report.id,
        changes: { type: report.type, title: report.title, objectKey },
      });

      // Scheduled reports: email recipients a time-limited download link.
      // Best-effort — a mail failure must not fail the (already completed) report.
      if (emailRecipients && emailRecipients.length > 0) {
        try {
          const url = await generatePresignedDownloadUrl(objectKey, 7 * 24 * 60 * 60);
          await sendMail({
            to: emailRecipients,
            subject: `Your scheduled report is ready: ${report.title}`,
            text: `Your scheduled Dharma report "${report.title}" has been generated.\n\nDownload (link valid 7 days):\n${url}`,
          });
        } catch (mailError) {
          logger.warn({ err: mailError, reportId: report.id }, "report email delivery failed");
        }
      }

      return { reportId: report.id, objectKey };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.report.update({
        where: { id: report.id },
        data: {
          status: "FAILED",
          // Generic, safe-for-UI message; the detail is in the audit metadata.
          errorMessage: "Report generation failed. Please retry or contact support.",
        },
      });
      await emitAuditEvent(prisma, {
        organizationId,
        userId: report.generatedById,
        action: "REPORT_GENERATION_FAILED",
        entity: "Report",
        entityId: report.id,
        // Raw error goes to audit metadata ONLY, never to the client.
        changes: { type: report.type, error: message },
      });
      logger.error({ err: error, reportId: report.id }, "report generation failed");
      throw error; // let BullMQ record the failure / retry
    }
  };
}

export function startReportWorker(prisma: PrismaClient = sharedPrisma) {
  const worker = new Worker<ReportGenerationJobData>(
    REPORT_GENERATION_QUEUE_NAME,
    createReportProcessor(prisma),
    {
      connection: redisConnection(),
      // PDF rendering is CPU-heavy; keep concurrency modest.
      concurrency: Number(process.env.REPORT_WORKER_CONCURRENCY ?? 2),
    },
  );
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id, reportId: job?.data.reportId }, "report worker failed");
  });
  return worker;
}
