/**
 * src/server/routers/evidence.ts
 *
 * Evidence management tRPC router.
 *
 * Procedures:
 *   getUploadUrl          – generate a presigned MinIO PUT URL for direct browser uploads
 *   create                – register an evidence record after the file has been uploaded
 *   list                  – list evidence for the org, optionally filtered by controlId or type
 *   getById               – fetch a single evidence record and attach a presigned download URL
 *   delete                – delete evidence from both MinIO and the database
 *   updateSummary         – update the AI-generated summary field
 *   requestAIMapping      – enqueue a BullMQ job to extract text, embed and classify evidence
 *   getAIRecommendations  – query pgvector cosine similarity to surface the top-3 matching controls
 *   acceptMapping         – re-link evidence to accepted control + update status + write audit log
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
import { evidenceQueue } from "@/workers/classification";

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

  // ----------------------------------------------------------------
  // AI Classification procedures
  // ----------------------------------------------------------------

  /**
   * Enqueue a BullMQ job to:
   *   1. Download the file from MinIO.
   *   2. Extract text (PDF / OCR).
   *   3. Generate a 384-dim embedding via Ollama nomic-embed-text.
   *   4. Persist embedding + summary to the Evidence row.
   *
   * Returns immediately with { jobId, status: 'QUEUED' }.
   */
  requestAIMapping: managerProcedure
    .input(z.object({ evidenceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Verify the evidence belongs to the caller's organisation
      const evidence = await ctx.prisma.evidence.findFirst({
        where: {
          id: input.evidenceId,
          organizationId: ctx.session.user.organizationId,
        },
        select: { id: true, filePath: true },
      });

      if (!evidence) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found for the current organisation.",
        });
      }

      // Enqueue the BullMQ classification job
      const job = await evidenceQueue.add(
        "process-evidence",
        { evidenceId: evidence.id },
        { jobId: `ev-${evidence.id}-${Date.now()}` },
      );

      return { jobId: job.id ?? "", status: "QUEUED" as const };
    }),

  /**
   * Perform a pgvector cosine-similarity search against Controls that belong
   * to the organisation's frameworks.
   *
   * Algorithm:
   *   1. Verify the evidence exists and has an embedding stored.
   *   2. Run a pgvector <=> (cosine distance) query comparing e.embedding
   *      directly against c.embedding for every Control in the org.
   *   3. Fall back to a non-vector listing if no control embeddings exist yet
   *      (pre-seed state) so the UI always has something to show.
   *
   * Returns: { status, recommendations[] } where status is
   *   'PENDING_ANALYSIS' (no evidence embedding yet) or 'READY'.
   *
   * Distance: 0.0 = identical vectors, 1.0 = orthogonal, 2.0 = opposite.
   * matchPercentage = max(0, round((1 − distance) × 100)).
   */
  getAIRecommendations: orgProcedure
    .input(z.object({ evidenceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // -----------------------------------------------------------------------
      // Step 1: Verify org ownership and check embedding presence.
      // Raw SQL is required because the `embedding` field is typed as
      // Unsupported("vector(384)") in Prisma and is not accessible via the
      // generated client's typed select API.
      // -----------------------------------------------------------------------
      type EmbeddingRow = { id: string; has_embedding: boolean };

      const ownerRows = await ctx.prisma.$queryRawUnsafe<EmbeddingRow[]>(
        `SELECT id, (embedding IS NOT NULL) AS has_embedding
           FROM "Evidence"
          WHERE id = $1
            AND "organizationId" = $2
          LIMIT 1`,
        input.evidenceId,
        ctx.session.user.organizationId,
      );

      if (ownerRows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found.",
        });
      }

      if (!ownerRows[0]!.has_embedding) {
        // Embedding not stored yet — job is still running
        return {
          recommendations: [] as Array<{
            id: string;
            title: string;
            domain: string;
            description: string;
            distance: number;
            matchPercentage: number;
          }>,
          status: "PENDING_ANALYSIS" as const,
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Cosine-distance ANN search.
      //
      // Correct query: compare Evidence.embedding against Control.embedding.
      // We use a single-row sub-select to pull the evidence embedding as a
      // scalar expression so pgvector can use the HNSW index on "Control".
      // -----------------------------------------------------------------------
      type SimilarityRow = {
        id: string;
        title: string;
        domain: string;
        description: string;
        distance: number;
      };

      const vectorRows = await ctx.prisma.$queryRawUnsafe<SimilarityRow[]>(
        `
        SELECT
          c.id,
          c.title,
          c.domain,
          c.description,
          (c.embedding <=> (
            SELECT embedding FROM "Evidence" WHERE id = $1
          )) AS distance
        FROM "Control" c
        JOIN "Framework" f ON f.id = c."frameworkId"
        WHERE f."organizationId" = $2
          AND c.embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT 3
        `,
        input.evidenceId,
        ctx.session.user.organizationId,
      );

      // Fallback: no control embeddings seeded yet — return top controls without
      // vector scoring so the UI always has something to display.
      const resultRows: SimilarityRow[] =
        vectorRows.length > 0
          ? vectorRows
          : await ctx.prisma.$queryRawUnsafe<SimilarityRow[]>(
              `
              SELECT
                c.id,
                c.title,
                c.domain,
                c.description,
                1.0 AS distance
              FROM "Control" c
              JOIN "Framework" f ON f.id = c."frameworkId"
              WHERE f."organizationId" = $1
              ORDER BY c."createdAt" ASC
              LIMIT 3
              `,
              ctx.session.user.organizationId,
            );

      const recommendations = resultRows.map((r) => ({
        id: r.id,
        title: r.title,
        domain: r.domain,
        description: r.description,
        distance: Number(r.distance),
        matchPercentage: Math.max(
          0,
          Math.round((1 - Number(r.distance)) * 100),
        ),
      }));

      return { recommendations, status: "READY" as const };
    }),

  /**
   * Accept an AI mapping suggestion.
   *
   * Actions (all in one request):
   *   1. Verify evidence belongs to the org.
   *   2. Verify the target control belongs to one of the org's frameworks.
   *   3. Update Evidence.controlId → controlId (re-links the evidence).
   *   4. Update Control.status → IN_PROGRESS (only if currently NOT_STARTED,
   *      never downgrade a COMPLIANT control).
   *   5. Write a SHA-256-chained AuditLog entry with action
   *      'EVIDENCE_MAPPED_TO_CONTROL' capturing the before/after state.
   *
   * Returns: { evidence, control } for the caller to update its cache.
   */
  acceptMapping: managerProcedure
    .input(
      z.object({
        evidenceId: z.string().min(1),
        controlId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.user.organizationId;

      // -----------------------------------------------------------------------
      // 1. Load evidence — verify org ownership
      // -----------------------------------------------------------------------
      const evidence = await ctx.prisma.evidence.findFirst({
        where: { id: input.evidenceId, organizationId: orgId },
        select: {
          id: true,
          controlId: true,
          fileName: true,
          control: { select: { title: true } },
        },
      });

      if (!evidence) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Evidence not found for the current organisation.",
        });
      }

      // -----------------------------------------------------------------------
      // 2. Load target control — verify it belongs to the org's frameworks
      // -----------------------------------------------------------------------
      const targetControl = await ctx.prisma.control.findFirst({
        where: {
          id: input.controlId,
          framework: { organizationId: orgId },
        },
        select: { id: true, title: true, domain: true, status: true },
      });

      if (!targetControl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Control not found for the current organisation.",
        });
      }

      const previousControlId = evidence.controlId;
      const previousControlTitle = evidence.control?.title ?? null;
      const previousControlStatus = targetControl.status;

      // -----------------------------------------------------------------------
      // 3. Re-link evidence to the accepted control
      // -----------------------------------------------------------------------
      const updatedEvidence = await ctx.prisma.evidence.update({
        where: { id: input.evidenceId },
        data: { controlId: input.controlId },
        select: {
          id: true,
          fileName: true,
          type: true,
          summary: true,
          collectedAt: true,
          controlId: true,
          control: {
            select: { id: true, title: true, domain: true, status: true },
          },
        },
      });

      // -----------------------------------------------------------------------
      // 4. Conditionally advance control status
      //    NOT_STARTED → IN_PROGRESS
      //    IN_PROGRESS / COMPLIANT / NOT_APPLICABLE → unchanged
      // -----------------------------------------------------------------------
      let updatedControl = targetControl;
      if (targetControl.status === "NOT_STARTED") {
        updatedControl = await ctx.prisma.control.update({
          where: { id: input.controlId },
          data: { status: "IN_PROGRESS" },
          select: { id: true, title: true, domain: true, status: true },
        });
      }

      // -----------------------------------------------------------------------
      // 5. Write chained audit log
      // -----------------------------------------------------------------------
      await createAuditLog(ctx.prisma, {
        organizationId: orgId,
        userId: ctx.session.user.id,
        action: "EVIDENCE_MAPPED_TO_CONTROL",
        entity: "Evidence",
        entityId: input.evidenceId,
        changes: {
          evidenceFileName: evidence.fileName,
          previousControlId,
          previousControlTitle,
          newControlId: input.controlId,
          newControlTitle: targetControl.title,
          newControlDomain: targetControl.domain,
          controlStatusBefore: previousControlStatus,
          controlStatusAfter: updatedControl.status,
        },
      });

      return {
        evidence: updatedEvidence,
        control: updatedControl,
      };
    }),
});
