/**
 * src/server/routers/audit.ts
 *
 * Audit log tRPC router.
 *
 * Procedures:
 *   list                  – paginated list of audit log entries (admin only)
 *   verifyIntegrity       – synchronous SHA-256 chain verification over a range
 *   startVerification     – background verification for chains too large to walk inline
 *   getVerification       – poll a background verification
 *   listVerifications     – recent verification runs
 *   getVerificationReportUrl – download the signed verification artefact
 *   getById               – fetch a single log entry with its hash fields
 *   listActions           – distinct action names for filter dropdown
 *   getAnchors            – list WORM anchor records for the org (Phase 2)
 *   verifyAgainstAnchor   – round-trip verify against WORM storage (Phase 2)
 *   triggerManualAnchor   – enqueue an immediate anchor job (Phase 2, admin)
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  countVerifiableEntries,
  verifyChainRange,
  SYNC_VERIFICATION_LIMIT,
} from "@/server/services/audit/chainVerification";
import { enqueueChainVerification } from "@/server/queue/auditVerificationQueue";
import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";
import { anchorQueue, type AnchorJobData } from "@/workers/anchor";
import { verifyAgainstStoredAnchor } from "@/lib/services/chainAnchor";
import { createAuditLog } from "@/server/audit-log";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { getAuditEventChain } from "@/server/services/audit/graph.service";
import {
  siemExportConfigSchema,
  parseStoredSiemConfig,
  splunkHecConfigSchema,
  syslogConfigSchema,
} from "@/server/services/audit/siem-export";
import { encryptSiemSecret } from "@/server/lib/crypto/siemVault";
import { putObject, generatePresignedDownloadUrl } from "@/server/minio";


export const auditRouter = createTRPCRouter({
  /**
   * Paginated audit log for the current organisation (admin-only).
   *
   * Returns logs ordered newest-first with user info attached.
   * Uses cursor-based pagination to avoid heavy OFFSET scans on large tables.
   */
  // Phase 8 Part 2: gated by requirePermission("audit.read") — identical
  // reach for legacy enum roles (ADMIN only), but grantable to custom roles.
  // Adds date-range and actor filters for the enterprise audit viewer.
  list: permissionProcedure("audit.read")
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().optional(), // cuid of the last seen entry
        action: z.string().optional(), // filter by action name
        entity: z.string().optional(), // filter by entity type
        actorId: z.string().optional(), // filter by acting user
        from: z.date().optional(), // date-range start (inclusive)
        to: z.date().optional(), // date-range end (inclusive)
      }).default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.auditLog.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          ...(input.action ? { action: input.action } : {}),
          ...(input.entity ? { entity: input.entity } : {}),
          ...(input.actorId ? { userId: input.actorId } : {}),
          ...(input.from || input.to
            ? {
                timestamp: {
                  ...(input.from ? { gte: input.from } : {}),
                  ...(input.to ? { lte: input.to } : {}),
                },
              }
            : {}),
          ...(input.cursor
            ? {
                // cursor is a cuid; sort by timestamp desc so cursor points to an older entry
                id: { lt: input.cursor },
              }
            : {}),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ timestamp: "desc" }, { createdAt: "desc" }],
        take: input.limit + 1,
      });

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      return { items: data, nextCursor, hasMore };
    }),

  /**
   * Verify the SHA-256 hash chain for the current organisation.
   *
   * Loads all logs in ascending order and re-computes each hash.
   * Returns:
   *   ok          – true if the chain is intact
   *   brokenAtId  – id of the first broken entry (null if ok)
   *   reason      – human-readable explanation (null if ok)
   *   checkedAt   – server timestamp of the verification run
   *   totalChecked – number of log entries inspected
   */
  /**
   * GH #26 — synchronous verification, now range-aware and bounded.
   *
   * This used to `findMany` the organization's ENTIRE audit log into the
   * request thread and hash it there. That is fine on a demo org and a
   * process-killer on the customer this feature exists for. It now streams in
   * pages (see chainVerification.ts) and refuses outright above
   * SYNC_VERIFICATION_LIMIT, telling the caller to use `startVerification`.
   *
   * Refusing rather than silently truncating: a verification that quietly
   * checked the first 25,000 of 400,000 entries and reported "chain intact"
   * would be worse than no feature at all — it would be a false attestation.
   */
  verifyIntegrity: orgProcedure
    .input(
      z
        .object({
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const range = { from: input?.from ?? null, to: input?.to ?? null };

      const total = await countVerifiableEntries(ctx.prisma, organizationId, range);
      if (total > SYNC_VERIFICATION_LIMIT) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message:
            `This range covers ${total.toLocaleString()} entries, which is too many to verify ` +
            "while you wait. Start a background verification instead.",
        });
      }

      return verifyChainRange(ctx.prisma, organizationId, range);
    }),

  /**
   * GH #26 — start a background verification over any range, however large.
   *
   * Returns immediately with the row id; the UI polls `getVerification`.
   */
  startVerification: permissionProcedure("audit.read")
    .input(
      z
        .object({
          from: z.date().optional(),
          to: z.date().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // One at a time per org. A second concurrent walk over the same chain
      // produces the same answer at twice the database cost, and during an
      // incident people press the button repeatedly.
      const running = await ctx.prisma.auditChainVerification.findFirst({
        where: { organizationId, status: "RUNNING" },
        select: { id: true },
      });
      if (running) {
        return { verificationId: running.id, alreadyRunning: true };
      }

      const row = await ctx.prisma.auditChainVerification.create({
        data: {
          organizationId,
          trigger: "MANUAL",
          status: "RUNNING",
          rangeFrom: input?.from ?? null,
          rangeTo: input?.to ?? null,
          partial: Boolean(input?.from),
          requestedById: ctx.session.user.id,
        },
        select: { id: true },
      });

      await enqueueChainVerification({
        verificationId: row.id,
        organizationId,
        rangeFrom: input?.from?.toISOString() ?? null,
        rangeTo: input?.to?.toISOString() ?? null,
      });

      // Verifying the audit log is itself an auditable act — an auditor asking
      // "who checked this, and when" must find the answer inside the log.
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "AUDIT_CHAIN_VERIFICATION_STARTED",
        entity: "AuditChainVerification",
        entityId: row.id,
        changes: {
          rangeFrom: input?.from?.toISOString() ?? null,
          rangeTo: input?.to?.toISOString() ?? null,
        },
      });

      return { verificationId: row.id, alreadyRunning: false };
    }),

  /** Poll a background verification. */
  getVerification: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.auditChainVerification.findFirst({
        where: { id: input.id, organizationId: ctx.session.user.organizationId },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Verification not found." });
      }
      return row;
    }),

  /** Recent verification runs — the history an auditor asks to see. */
  listVerifications: orgProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.auditChainVerification.findMany({
        where: { organizationId: ctx.session.user.organizationId },
        orderBy: { startedAt: "desc" },
        take: input?.limit ?? 10,
        include: { requestedBy: { select: { name: true, email: true } } },
      });
    }),

  /**
   * Mint a download URL for the signed verification report.
   *
   * The URL is generated on demand rather than stored, so a verification from
   * six months ago still downloads instead of resolving to an expired link.
   */
  getVerificationReportUrl: permissionProcedure("audit.export")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.auditChainVerification.findFirst({
        where: { id: input.id, organizationId: ctx.session.user.organizationId },
        select: { reportObjectKey: true, status: true },
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Verification not found." });
      }
      if (!row.reportObjectKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            row.status === "RUNNING"
              ? "This verification is still running."
              : "No signed report was produced for this verification.",
        });
      }
      return { url: await generatePresignedDownloadUrl(row.reportObjectKey) };
    }),

  /**
   * Fetch a single audit log entry by id (admin-only).
   * Includes the full currentHash and previousHash for manual inspection.
   */
  getById: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const log = await ctx.prisma.auditLog.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.session.user.organizationId,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      if (!log) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Audit log entry not found.",
        });
      }

      return log;
    }),

  /**
   * Return the list of distinct action names seen in this org's audit log.
   * Useful for building filter dropdowns in the UI.
   */
  listActions: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.auditLog.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    });

    return rows.map((r) => r.action);
  }),

  // ────────────────────────────────────────────────────────────────
  // Phase 2 Feature 3 — WORM Anchor procedures
  // ────────────────────────────────────────────────────────────────

  /**
   * List ChainAnchor records for the current organisation, newest first.
   */
  getAnchors: adminProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(50).default(20) }).default({}),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.chainAnchor.findMany({
        where: { organizationId: ctx.session.user.organizationId },
        orderBy: { anchoredAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          rootHash: true,
          recordCount: true,
          fromLogId: true,
          toLogId: true,
          anchoredAt: true,
          storageKey: true,
          publicProof: true,
        },
      });
    }),

  /**
   * Round-trip verify a specific anchor against WORM storage.
   * Returns whether the current chain matches the stored manifest.
   */
  verifyAgainstAnchor: adminProcedure
    .input(z.object({ anchorId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      try {
        const result = await verifyAgainstStoredAnchor(
          ctx.prisma,
          input.anchorId,
          organizationId,
        );
        return result;
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),

  /**
   * Enqueue an immediate single-org anchor job.
   * Useful for the "Anchor Now" admin button.
   */
  triggerManualAnchor: adminProcedure.mutation(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;
    const job = await anchorQueue.add(
      "manual-anchor",
      { organizationId } satisfies AnchorJobData,
      { priority: 1 }, // run before scheduled jobs
    );

    await createAuditLog(ctx.prisma, {
      organizationId,
      userId: ctx.session.user.id,
      action: "AUDIT_ANCHOR_TRIGGERED",
      entity: "ChainAnchor",
      entityId: job.id ?? "unknown",
      changes: { triggeredManually: true },
    });

    return { jobId: job.id };
  }),

  // ────────────────────────────────────────────────────────────────
  // Phase 8 Part 2 — enterprise audit viewer additions.
  // Append-only invariant: this router (and the whole app) exposes NO
  // update or delete path for AuditLog rows — verified by
  // tests/audit.appendOnly.test.ts.
  // ────────────────────────────────────────────────────────────────

  /**
   * CSV export: written server-side to MinIO (the existing S3-compatible
   * store), returned as a short-lived pre-signed download URL — the
   * established file-delivery pattern, not a new one.
   */
  exportCsv: permissionProcedure("audit.export")
    .input(
      z.object({
        action: z.string().optional(),
        entity: z.string().optional(),
        actorId: z.string().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
      }).default({}),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const rows = await ctx.prisma.auditLog.findMany({
        where: {
          organizationId,
          ...(input.action ? { action: input.action } : {}),
          ...(input.entity ? { entity: input.entity } : {}),
          ...(input.actorId ? { userId: input.actorId } : {}),
          ...(input.from || input.to
            ? {
                timestamp: {
                  ...(input.from ? { gte: input.from } : {}),
                  ...(input.to ? { lte: input.to } : {}),
                },
              }
            : {}),
        },
        include: { user: { select: { email: true } } },
        orderBy: { timestamp: "asc" },
        take: 50_000, // hard cap keeps export memory bounded
      });

      const escape = (value: unknown) => {
        let text = value == null ? "" : String(value);
        // Formula-injection guard: a leading = + - @ executes in Excel/Sheets.
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const header = "timestamp,action,actorEmail,entity,entityId,changes,currentHash";
      const csv = [
        header,
        ...rows.map((row) =>
          [
            row.timestamp.toISOString(),
            row.action,
            row.user?.email ?? (row.userId ?? "system"),
            row.entity,
            row.entityId,
            JSON.stringify(row.changes ?? null),
            row.currentHash,
          ]
            .map(escape)
            .join(","),
        ),
      ].join("\n");

      const objectName = `${organizationId}/audit-exports/${Date.now()}-audit-log.csv`;
      await putObject(objectName, csv, "text/csv");
      const downloadUrl = await generatePresignedDownloadUrl(objectName, 15 * 60);

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "AUDIT_LOG_EXPORTED",
        entity: "AuditLog",
        entityId: objectName,
        changes: { rowCount: rows.length, filters: input },
      });

      return { downloadUrl, rowCount: rows.length };
    }),

  /**
   * "Related events" chain for one audit entry: correlation-graph walk plus
   * same-actor-session / same-resource temporal joins (graph.service.ts).
   */
  getEventChain: permissionProcedure("audit.read")
    .input(
      z.object({
        auditLogId: z.string().min(1),
        hops: z.number().int().min(1).max(4).default(2),
      }),
    )
    .query(async ({ ctx, input }) => {
      return getAuditEventChain(
        ctx.prisma,
        ctx.session.user.organizationId,
        input.auditLogId,
        input.hops,
      );
    }),

  getSiemConfig: permissionProcedure("audit.export").query(async ({ ctx }) => {
    const settings = await ctx.prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.session.user.organizationId },
      select: { siemExportConfig: true },
    });
    const config = parseStoredSiemConfig(settings?.siemExportConfig);
    if (!config) return null;
    // Redact the HEC token envelope on read.
    return config.type === "splunk-hec"
      ? { type: config.type, url: config.url, index: config.index ?? null, tokenSet: true }
      : { type: config.type, host: config.host, port: config.port, protocol: config.protocol };
  }),

  configureSiemExport: permissionProcedure("audit.export")
    .input(
      z.union([
        splunkHecConfigSchema
          .omit({ tokenEnc: true })
          .extend({ token: z.string().min(1).max(4096) }),
        syslogConfigSchema,
        z.object({ type: z.literal("disabled") }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const stored =
        input.type === "disabled"
          ? null
          : input.type === "splunk-hec"
            ? siemExportConfigSchema.parse({
                type: "splunk-hec",
                url: input.url,
                index: input.index,
                sourcetype: input.sourcetype,
                tokenEnc: encryptSiemSecret(input.token),
              })
            : siemExportConfigSchema.parse(input);

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          siemExportConfig: stored ?? Prisma.DbNull,
        },
        update: { siemExportConfig: stored ?? Prisma.DbNull },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "SIEM_EXPORT_CONFIGURED",
        entity: "OrganizationSettings",
        entityId: organizationId,
        // Never the token — only the target shape.
        changes:
          stored === null
            ? { disabled: true }
            : stored.type === "splunk-hec"
              ? { type: stored.type, url: stored.url }
              : { type: stored.type, host: stored.host, port: stored.port },
      });

      return { configured: stored !== null };
    }),
});
