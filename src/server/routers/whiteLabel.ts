// Phase 8 Part 2 — white-label settings router (App Flow journey 6 steps
// 5-6): logo via MinIO pre-signed upload (existing pattern), primary-color
// hex validation, custom-domain CNAME verification before activation.
import { randomUUID } from "node:crypto";
import { resolveCname } from "node:dns/promises";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";
import {
  whiteLabelSchema,
  parseStoredWhiteLabel,
  type WhiteLabelConfig,
} from "@/lib/theme/getTenantTheme";
import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
} from "@/server/minio";
import { env } from "@/env";

const updateInputSchema = whiteLabelSchema
  .omit({ customDomainVerified: true })
  .partial();

export const whiteLabelRouter = createTRPCRouter({
  getSettings: permissionProcedure("whitelabel.manage").query(async ({ ctx }) => {
    const settings = await ctx.prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.session.user.organizationId },
      select: { whiteLabel: true },
    });
    const config = parseStoredWhiteLabel(settings?.whiteLabel) ?? {};
    return {
      ...config,
      logoPreviewUrl: config.logoKey
        ? await generatePresignedDownloadUrl(config.logoKey, 15 * 60)
        : null,
      expectedCnameTarget: new URL(env.NEXTAUTH_URL).hostname,
    };
  }),

  /** Pre-signed PUT URL for the logo (reuses the Phase 0 MinIO pattern). */
  requestLogoUpload: permissionProcedure("whitelabel.manage")
    .input(z.object({ fileName: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "png";
      if (!["png", "jpg", "jpeg", "svg", "webp"].includes(ext)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Logo must be png, jpg, svg, or webp.",
        });
      }
      const logoKey = `${ctx.session.user.organizationId}/white-label/logo-${randomUUID()}.${ext}`;
      const uploadUrl = await generatePresignedUploadUrl(logoKey, 10 * 60);
      return { uploadUrl, logoKey };
    }),

  updateSettings: permissionProcedure("whitelabel.manage")
    .input(updateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const settings = await ctx.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { whiteLabel: true },
      });
      const current = parseStoredWhiteLabel(settings?.whiteLabel) ?? {};

      // A tenant claiming a logoKey outside its own MinIO prefix could read
      // another org's object through the theme's presigned URL — reject.
      if (input.logoKey && !input.logoKey.startsWith(`${organizationId}/`)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "logoKey does not belong to this organization.",
        });
      }

      const domainChanged =
        input.customDomain !== undefined &&
        input.customDomain !== current.customDomain;

      if (domainChanged && input.customDomain) {
        const taken = await ctx.prisma.organizationSettings.findFirst({
          where: {
            organizationId: { not: organizationId },
            whiteLabel: { path: ["customDomain"], equals: input.customDomain },
          },
          select: { id: true },
        });
        if (taken) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That domain is already claimed by another workspace.",
          });
        }
      }

      const next: WhiteLabelConfig = whiteLabelSchema.parse({
        ...current,
        ...input,
        // Any domain change resets verification — activation requires a
        // fresh CNAME check.
        customDomainVerified: domainChanged ? false : current.customDomainVerified,
      });

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId },
        create: { organizationId, whiteLabel: next },
        update: { whiteLabel: next },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WHITE_LABEL_UPDATED",
        entity: "OrganizationSettings",
        entityId: organizationId,
        changes: {
          fields: Object.keys(input),
          customDomain: next.customDomain ?? null,
          domainVerificationReset: domainChanged,
        },
      });

      return next;
    }),

  /**
   * Clears the tenant's visual overrides, returning the workspace to the base
   * Dharma tokens.
   *
   * Deliberately preserves customDomain and its verification state. Resetting
   * a theme is a styling action; dropping the domain would take the tenant's
   * URL offline and force a fresh CNAME round-trip to undo. Domains are
   * released through updateSettings, where that intent is explicit.
   */
  resetTheme: permissionProcedure("whitelabel.manage").mutation(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;
    const settings = await ctx.prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { whiteLabel: true },
    });
    const current = parseStoredWhiteLabel(settings?.whiteLabel) ?? {};

    const next: WhiteLabelConfig = whiteLabelSchema.parse({
      customDomain: current.customDomain,
      customDomainVerified: current.customDomainVerified,
    });

    await ctx.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, whiteLabel: next },
      update: { whiteLabel: next },
    });

    await emitAuditEvent(ctx.prisma, {
      organizationId,
      userId: ctx.session.user.id,
      action: "WHITE_LABEL_RESET",
      entity: "OrganizationSettings",
      entityId: organizationId,
      changes: {
        cleared: (["logoKey", "primaryColor", "css"] as const).filter(
          (field) => current[field] !== undefined,
        ),
        customDomainRetained: current.customDomain ?? null,
      },
    });

    return next;
  }),

  /** DNS CNAME verification — the domain activates only after this passes. */
  verifyCustomDomain: permissionProcedure("whitelabel.manage").mutation(
    async ({ ctx }) => {
      const organizationId = ctx.session.user.organizationId;
      const settings = await ctx.prisma.organizationSettings.findUnique({
        where: { organizationId },
        select: { whiteLabel: true },
      });
      const config = parseStoredWhiteLabel(settings?.whiteLabel);
      if (!config?.customDomain) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Set a custom domain before verifying it.",
        });
      }

      const expectedTarget = new URL(env.NEXTAUTH_URL).hostname.toLowerCase();
      let records: string[] = [];
      try {
        records = await resolveCname(config.customDomain);
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No CNAME record found for ${config.customDomain}. Point it at ${expectedTarget} and retry.`,
        });
      }

      const matches = records.some(
        (record) => record.toLowerCase().replace(/\.$/, "") === expectedTarget,
      );
      if (!matches) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `CNAME for ${config.customDomain} points at ${records.join(", ")} — expected ${expectedTarget}.`,
        });
      }

      const verified: WhiteLabelConfig = { ...config, customDomainVerified: true };
      await ctx.prisma.organizationSettings.update({
        where: { organizationId },
        data: { whiteLabel: verified },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WHITE_LABEL_DOMAIN_VERIFIED",
        entity: "OrganizationSettings",
        entityId: organizationId,
        changes: { customDomain: config.customDomain },
      });

      return { verified: true, customDomain: config.customDomain };
    },
  ),
});
