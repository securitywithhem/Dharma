/**
 * src/server/routers/aiIngestion.ts
 *
 * Phase 7 Part 1 — AI Advisor document-ingestion API.
 *
 * The file itself is uploaded straight to MinIO via the existing pre-signed-URL
 * flow (Phase 0/4); these endpoints only manage the IngestedDocument record and
 * the background pipeline. Everything is org-scoped via `ctx.session.user`.
 *
 * NOTE: chat/RAG endpoints are Part 2 — intentionally not here.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { enqueueAiIngestion } from "@/server/queue/aiIngestionQueue";
import { pruneGraphForDocument } from "@/server/ai/graphExtraction";
import { deleteFile, generatePresignedUploadUrl } from "@/lib/storage/minioClient";

export const aiIngestionRouter = createTRPCRouter({
  /**
   * Presigned MinIO PUT URL for a browser to upload an advisor document
   * directly. Returns `{ uploadUrl, s3Key }`; the client PUTs the file then
   * calls `uploadDocument` with the returned `s3Key`.
   */
  getUploadUrl: orgProcedure
    .input(z.object({ filename: z.string().min(1).max(512), mimeType: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const { uploadUrl, objectKey } = await generatePresignedUploadUrl(input.filename, input.mimeType);
      return { uploadUrl, s3Key: objectKey };
    }),

  /**
   * Register an already-uploaded document (in MinIO under `s3Key`) for
   * ingestion and enqueue the pipeline job. Returns the new document id for
   * the client to poll `getDocumentStatus` against.
   */
  uploadDocument: orgProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(512),
        mimeType: z.string().min(1).max(255),
        s3Key: z.string().min(1).max(1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const userId = ctx.session.user.id;

      const doc = await ctx.prisma.ingestedDocument.create({
        data: {
          organizationId,
          uploadedById: userId,
          filename: input.filename,
          mimeType: input.mimeType,
          s3Key: input.s3Key,
          status: "PENDING",
        },
        select: { id: true },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId,
        action: "AI_DOCUMENT_UPLOADED",
        entity: "IngestedDocument",
        entityId: doc.id,
        changes: { filename: input.filename, mimeType: input.mimeType },
      });

      await enqueueAiIngestion(doc.id);

      return { documentId: doc.id };
    }),

  /** Poll pipeline status for one document (org-scoped). */
  getDocumentStatus: orgProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const doc = await ctx.prisma.ingestedDocument.findFirst({
        where: { id: input.documentId, organizationId },
        select: {
          id: true,
          filename: true,
          status: true,
          chunkCount: true,
          graphNodeCount: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found for the current organization." });
      }
      return doc;
    }),

  /** Cursor-paginated list of the org's ingested documents (newest first). */
  listIngestedDocuments: orgProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(25),
          cursor: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const items = await ctx.prisma.ingestedDocument.findMany({
        where: { organizationId, ...(input.cursor ? { id: { lt: input.cursor } } : {}) },
        orderBy: { id: "desc" },
        take: input.limit + 1,
        select: {
          id: true,
          filename: true,
          mimeType: true,
          status: true,
          chunkCount: true,
          graphNodeCount: true,
          createdAt: true,
        },
      });
      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;
      return { items: data, nextCursor, hasMore };
    }),

  /**
   * Delete a document and everything derived from it: its embeddings (FK
   * cascade) and its knowledge-graph nodes/edges (explicit prune, so no
   * orphaned graph data survives — a data-retention requirement). Best-effort
   * removal of the MinIO object too. Management-only (destructive).
   */
  deleteIngestedDocument: permissionProcedure("evidence.upload")
    .input(z.object({ documentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const doc = await ctx.prisma.ingestedDocument.findFirst({
        where: { id: input.documentId, organizationId },
        select: { id: true, s3Key: true, filename: true },
      });
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found for the current organization." });
      }

      // Prune the knowledge graph first (explicit — mirrors "call Graphify's
      // delete API"). FK cascade would also remove these on doc delete, but we
      // don't rely on it for the compliance-critical graph cleanup.
      await pruneGraphForDocument(ctx.prisma, organizationId, doc.id);

      // Delete the doc — OrganizationEmbedding rows cascade via sourceDocumentId.
      await ctx.prisma.ingestedDocument.delete({ where: { id: doc.id } });

      // Best-effort: remove the underlying object from storage.
      await deleteFile(doc.s3Key).catch((e) => console.error("[ai-ingestion] MinIO delete failed:", e));

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "AI_DOCUMENT_DELETED",
        entity: "IngestedDocument",
        entityId: doc.id,
        changes: { filename: doc.filename },
      });

      return { success: true };
    }),
});
