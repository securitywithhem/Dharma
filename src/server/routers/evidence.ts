/**
 * src/server/routers/evidence.ts
 *
 * Evidence management tRPC router.
 *
 * Procedures:
 *   getUploadUrl  – generate a presigned MinIO PUT URL for direct browser uploads
 *   create        – register an evidence record after the file has been uploaded
 *   list          – list evidence for the org, optionally filtered by controlId or type
 *   getById       – fetch a single evidence record and attach a presigned download URL
 *   delete        – delete evidence from both MinIO and the database
 *   updateSummary – update the AI-generated summary field
 */

import crypto from "crypto";
import { EvidenceType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import {
  buildStorageKey,
  deleteObject,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
  initializeMinIOBucket,
} from "@/server/minio";

// Lazily ensure the bucket exists on first request
let bucketReady = false;

async function ensureBucket() {
  if (!bucketReady) {
    await initializeMinIOBucket();
    bucketReady = true;
  }
}

// ------------------------------------------------------------------
// Shared input validators
// ------------------------------------------------------------------

const evidenceTypeSchema = z.nativeEnum(EvidenceType);

// ------------------------------------------------------------------
// Router
// ------------------------------------------------------------------

export const evidenceRouter = createTRPCRouter({
  /**
   * Generate a presigned PUT URL for direct browser → MinIO upload.
   * The client should PUT the file bytes to this URL, then call `evidence.create`.
   *
   * Returns: { uploadUrl, filePath, expiresAt }
   */
  getUploadUrl: managerProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        contentType: z.string().min(1).max(127),
        controlId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureBucket();

      // Verify control belongs to the organisation
      const control = await ctx.prisma.control.findFirst({
        where: {
          id: input.controlId,
          framework: { organizationId: ctx.session.user.organizationId },
        },
        select: { id: true },
      });

      if (!control) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Control not found for the current organisation.",
        });
      }

      const uniqueId = crypto.randomUUID();
      const storageKey = buildStorageKey(
        ctx.session.user.organizationId,
        input.controlId,
        input.fileName,
        uniqueId,
      );

      const uploadUrl = await generatePresignedUploadUrl(storageKey);

      return {
        uploadUrl,
        filePath: storageKey,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      };
    }),

  /**
   * Register an evidence record in the database.
   * Call this after the browser has successfully PUT the file to MinIO.
   */
  create: managerProcedure
    .input(
      z.object({
        controlId: z.string().min(1),
        fileName: z.string().min(1).max(255),
        filePath: z.string().min(1).max(1024),
        type: evidenceTypeSchema,
        summary: z.string().max(5000).optional(),
        expiresAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify control ownership
      const control = await ctx.prisma.control.findFirst({
        where: {
          id: input.controlId,
          framework: { organizationId: ctx.session.user.organizationId },
        },
        select: { id: true, title: true },
      });

      if (!control) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Control not found for the current organisation.",
        });
      }

      const evidence = await ctx.prisma.evidence.create({
        data: {
          controlId: input.controlId,
          organizationId: ctx.session.user.organizationId,
          fileName: input.fileName,
          filePath: input.filePath,
          type: input.type,
          summary: input.summary,
          expiresAt: input.expiresAt,
          collectedAt: new Date(),
        },
        include: {
          control: { select: { id: true, title: true, domain: true } },
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_UPLOADED",
        entity: "Evidence",
        entityId: evidence.id,
        changes: {
          fileName: input.fileName,
          type: input.type,
          controlId: input.controlId,
          controlTitle: control.title,
        },
      });

      return evidence;
    }),

  /**
   * List evidence for the current organisation.
   * Optionally filter by controlId and/or EvidenceType.
   */
  list: orgProcedure
    .input(
      z.object({
        controlId: z.string().optional(),
        type: evidenceTypeSchema.optional(),
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().optional(), // cuid for cursor-based pagination
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.evidence.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          ...(input.controlId ? { controlId: input.controlId } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        include: {
          control: { select: { id: true, title: true, domain: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1, // fetch one extra to know if there's a next page
      });

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      return { items: data, nextCursor, hasMore };
    }),

  /**
   * Fetch a single evidence record and attach a short-lived download URL.
   */
  getById: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const evidence = await ctx.prisma.evidence.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
        include: {
          control: { select: { id: true, title: true, domain: true } },
        },
      });

      if (!evidence) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found.",
        });
      }

      const downloadUrl = await generatePresignedDownloadUrl(evidence.filePath);

      return { ...evidence, downloadUrl };
    }),

  /**
   * Delete evidence: removes the file from MinIO then the database row.
   * Falls back gracefully if the MinIO object is already gone.
   */
  delete: managerProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const evidence = await ctx.prisma.evidence.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
      });

      if (!evidence) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found.",
        });
      }

      // Delete from MinIO — ignore 404 (file may already be gone)
      try {
        await deleteObject(evidence.filePath);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code !== "NoSuchKey" && code !== "NotFound") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to remove file from storage.",
          });
        }
      }

      await ctx.prisma.evidence.delete({ where: { id: input.id } });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_DELETED",
        entity: "Evidence",
        entityId: input.id,
        changes: { fileName: evidence.fileName, type: evidence.type },
      });

      return { success: true };
    }),

  /**
   * Update the optional AI-generated summary for an evidence record.
   */
  updateSummary: managerProcedure
    .input(
      z.object({
        id: z.string().min(1),
        summary: z.string().max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const evidence = await ctx.prisma.evidence.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
        select: { id: true },
      });

      if (!evidence) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found.",
        });
      }

      return ctx.prisma.evidence.update({
        where: { id: input.id },
        data: { summary: input.summary },
      });
    }),
});
