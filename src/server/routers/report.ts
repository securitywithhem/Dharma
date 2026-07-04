import { z } from 'zod';
import { createTRPCRouter, orgProcedure, adminProcedure } from '@/server/trpc';
import { aggregateReportData } from '@/lib/services/reportGenerator';
import { signPdf, uploadSignedPdf } from '@/lib/pdf/pdfSigner';
import { TRPCError } from '@trpc/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { ReportDocument } from '@/lib/pdf/ReportDocument';
import { createAuditLog } from '@/server/audit-log';
import React from 'react';

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
});
