import { z } from 'zod';
import { createTRPCRouter, orgProcedure, adminProcedure } from '@/server/trpc';
import { aggregateReportData } from '@/lib/services/reportGenerator';
import { signPdf, uploadSignedPdf } from '@/lib/pdf/pdfSigner';
import { TRPCError } from '@trpc/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument } from '@/lib/pdf/ReportDocument';
import { createAuditLog } from '@/server/audit-log';
import React from 'react';
// ── Phase 9 Part 2: Advanced reporting (custom PDF + AI board summaries) ────
import { emitAuditEvent } from '@/server/services/audit/writer';
import { enqueueReportGeneration } from '@/server/queue/reportQueue';
import { generatePresignedDownloadUrl, deleteObject } from '@/server/minio';
import { REPORT_SECTIONS } from '@/server/services/reportData';
import { reportCronPresets, type ReportCronPreset } from '@/server/lib/cronMatch';

const reportTypeSchema = z.enum(['CUSTOM_PDF', 'BOARD_SUMMARY']);
const cronPresetSchema = z.enum(['daily', 'weekly', 'monthly']);

// Report config validated per type. CUSTOM_PDF needs a non-empty section list;
// BOARD_SUMMARY is auto-composed (no section picker), only optional filters.
const reportConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CUSTOM_PDF'),
    sections: z.array(z.enum(REPORT_SECTIONS as [string, ...string[]])).min(1),
    frameworkIds: z.array(z.string()).optional(),
    from: z.string().datetime().nullish(),
    to: z.string().datetime().nullish(),
  }),
  z.object({
    type: z.literal('BOARD_SUMMARY'),
    frameworkIds: z.array(z.string()).optional(),
    from: z.string().datetime().nullish(),
    to: z.string().datetime().nullish(),
  }),
]);

// The nested report.schedule.* CRUD router.
const reportScheduleRouter = createTRPCRouter({
  list: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.reportSchedule.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        title: z.string().trim().min(2).max(200),
        config: reportConfigSchema,
        cadence: cronPresetSchema,
        recipients: z.array(z.string().email()).max(50).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const schedule = await ctx.prisma.reportSchedule.create({
        data: {
          organizationId,
          title: input.title,
          reportConfig: input.config,
          cron: reportCronPresets[input.cadence as ReportCronPreset],
          recipients: input.recipients,
          enabled: true,
        },
      });
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: 'REPORT_SCHEDULE_CREATED',
        entity: 'ReportSchedule',
        entityId: schedule.id,
        changes: { title: input.title, cadence: input.cadence, recipients: input.recipients.length },
      });
      return schedule;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().trim().min(2).max(200).optional(),
        cadence: cronPresetSchema.optional(),
        recipients: z.array(z.string().email()).max(50).optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const existing = await ctx.prisma.reportSchedule.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      const updated = await ctx.prisma.reportSchedule.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          cron: input.cadence ? reportCronPresets[input.cadence as ReportCronPreset] : undefined,
          recipients: input.recipients,
          enabled: input.enabled,
        },
      });
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: 'REPORT_SCHEDULE_UPDATED',
        entity: 'ReportSchedule',
        entityId: existing.id,
        changes: { fields: Object.keys(input).filter((k) => k !== 'id') },
      });
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const existing = await ctx.prisma.reportSchedule.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.reportSchedule.delete({ where: { id: existing.id } });
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: 'REPORT_SCHEDULE_DELETED',
        entity: 'ReportSchedule',
        entityId: existing.id,
        changes: { title: existing.title },
      });
      return { deleted: true };
    }),
});

export const reportRouter = createTRPCRouter({
  /**
   * Export compliance report as a signed PDF.
   * Aggregates all framework, control, evidence, and policy data into a professional report.
   * Signs the PDF and uploads to MinIO storage.
   * Returns a presigned download URL valid for 7 days.
   */
  exportReport: orgProcedure
    .input(z.object({ includeAuditLog: z.boolean().default(true) }))
    .mutation(async ({ input, ctx }) => {
      const { session } = ctx;
      const organizationId = session.user.organizationId;

      try {
        // Step 1: Aggregate report data
        console.log('📊 Aggregating report data for organization:', organizationId);
        const reportData = await aggregateReportData(organizationId);

        // Step 2: Generate PDF from React component
        console.log('📄 Rendering PDF document...');
        const pdfBuffer = await renderToBuffer(
          React.createElement(ReportDocument, { data: reportData }) as any
        );

        // Step 3: Sign PDF with organization key
        console.log('🔐 Signing PDF...');
        const { signedBuffer, signature, timestamp } = await signPdf(
          pdfBuffer,
          organizationId
        );

        // Step 4: Upload signed PDF to MinIO
        const reportFileName = `dharma-compliance-report-${new Date().getTime()}.pdf`;
        console.log('☁️ Uploading signed PDF to MinIO...');
        const downloadUrl = await uploadSignedPdf(
          signedBuffer,
          organizationId,
          reportFileName
        );

        // Step 5: Log audit entry
        await createAuditLog(ctx.prisma, {
          organizationId,
          userId: session.user.id,
          action: 'REPORT_EXPORT',
          entity: 'Report',
          entityId: reportFileName,
          changes: {
            complianceScore: reportData.complianceScore,
            verificationStatus: reportData.verificationStatus,
            frameworksIncluded: reportData.frameworks.length,
          },
        });

        return {
          downloadUrl,
          fileName: reportFileName,
          complianceScore: reportData.complianceScore,
          verificationStatus: reportData.verificationStatus,
          generatedAt: new Date().toISOString(),
          signature,
        };
      } catch (error) {
        console.error('❌ Error exporting report:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to export report',
          cause: error,
        });
      }
    }),

  /**
   * Get report history for the organization (list of previous exports).
   */
  getHistory: orgProcedure.query(async ({ ctx }) => {
    const { session, prisma } = ctx;
    const organizationId = session.user.organizationId;

    const reports = await prisma.auditLog.findMany({
      where: {
        organizationId,
        action: 'REPORT_EXPORT',
      },
      select: {
        id: true,
        entityId: true,
        timestamp: true,
        changes: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    return reports.map((report: any) => ({
      id: report.id,
      fileName: report.entityId,
      timestamp: report.timestamp,
      // @ts-ignore - Prisma JSON type issues
      complianceScore: report.changes?.complianceScore || 0,
      // @ts-ignore
      verificationStatus: report.changes?.verificationStatus || 'UNVERIFIED',
    }));
  }),

  // ── Phase 2 Feature 5: Auditor Export Package ─────────────────────────────

  /**
   * Trigger generation of a full offline auditor export ZIP.
   */
  exportAuditorPackage: adminProcedure
    .input(
      z.object({
        frameworkIds: z.array(z.string()).default([]),
        includeRawFiles: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { session } = ctx;
      const { auditorPackageQueue } = await import('@/workers/auditorPackage');

      const job = await auditorPackageQueue.add('export-auditor-package', {
        organizationId: session.user.organizationId,
        requestedBy: session.user.id,
        frameworkIds: input.frameworkIds,
        includeRawFiles: input.includeRawFiles,
      });

      return { jobId: job.id };
    }),

  /**
   * Poll the status of an auditor package export job.
   * Returns downloadUrl + expiresAt when completed.
   */
  getExportStatus: adminProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const { auditorPackageQueue } = await import('@/workers/auditorPackage');
      const { Job } = await import('bullmq');
      const job = await Job.fromId(auditorPackageQueue, input.jobId);

      if (!job) return { status: 'not_found' as const };
      const state = await job.getState();

      if (state === 'completed') {
        return { status: 'completed' as const, ...job.returnvalue };
      }
      if (state === 'failed') {
        return { status: 'failed' as const, error: job.failedReason };
      }

      return { status: 'active' as const };
    }),

  /**
   * List previous auditor export packages for the org.
   */
  listExports: adminProcedure.query(async ({ ctx }) => {
    return ctx.prisma.auditExport.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        frameworkIds: true,
        filePath: true,
        includeRawFiles: true,
        createdAt: true,
        expiresAt: true,
        requestedBy: true,
      },
    });
  }),

  // ── Phase 9 Part 2: report builder (Report model, async generation) ───────

  /**
   * Create a report (CUSTOM_PDF or BOARD_SUMMARY), enqueue generation, and
   * return the reportId immediately — never blocks on rendering.
   */
  create: orgProcedure
    .input(
      z.object({
        title: z.string().trim().min(2).max(200),
        config: reportConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // If framework filters are supplied, confirm they belong to this org —
      // a report must never be scoped to another tenant's frameworks.
      const frameworkIds = input.config.frameworkIds ?? [];
      if (frameworkIds.length > 0) {
        const owned = await ctx.prisma.framework.count({
          where: { id: { in: frameworkIds }, organizationId },
        });
        if (owned !== frameworkIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more frameworks do not belong to this organization.',
          });
        }
      }

      const report = await ctx.prisma.report.create({
        data: {
          organizationId,
          type: input.config.type,
          title: input.title,
          config: input.config,
          status: 'QUEUED',
          generatedById: ctx.session.user.id,
        },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: 'REPORT_REQUESTED',
        entity: 'Report',
        entityId: report.id,
        changes: { type: input.config.type, title: input.title },
      });

      await enqueueReportGeneration({ reportId: report.id, organizationId });

      return { reportId: report.id, status: report.status };
    }),

  /** Paginated report list, filterable by type/status. */
  list: orgProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
          type: reportTypeSchema.optional(),
          status: z.enum(['QUEUED', 'GENERATING', 'COMPLETED', 'FAILED']).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.report.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          ...(input.type ? { type: input.type } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit + 1,
        select: {
          id: true,
          type: true,
          title: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
        },
      });
      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: data,
        nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
        hasMore,
      };
    }),

  /** Report status + a fresh presigned download URL when COMPLETED. */
  get: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const report = await ctx.prisma.report.findFirst({
        where: { id: input.id, organizationId: ctx.session.user.organizationId },
      });
      if (!report) throw new TRPCError({ code: 'NOT_FOUND' });

      let downloadUrl: string | null = null;
      if (report.status === 'COMPLETED' && report.fileUrl) {
        downloadUrl = await generatePresignedDownloadUrl(report.fileUrl, 15 * 60);
      }
      return {
        id: report.id,
        type: report.type,
        title: report.title,
        status: report.status,
        errorMessage: report.errorMessage,
        createdAt: report.createdAt,
        completedAt: report.completedAt,
        downloadUrl,
      };
    }),

  /** Delete a report row and its underlying MinIO object (admin-only). */
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const report = await ctx.prisma.report.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!report) throw new TRPCError({ code: 'NOT_FOUND' });

      if (report.fileUrl) {
        // Best-effort object delete — a storage miss must not block the row delete.
        await deleteObject(report.fileUrl).catch(() => undefined);
      }
      await ctx.prisma.report.delete({ where: { id: report.id } });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: 'REPORT_DELETED',
        entity: 'Report',
        entityId: report.id,
        changes: { title: report.title, hadFile: Boolean(report.fileUrl) },
      });
      return { deleted: true };
    }),

  schedule: reportScheduleRouter,
});
