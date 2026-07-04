import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";
import { z } from "zod";
import {
  generateAuditorExchangeCode,
  hashAuditorToken,
} from "@/server/auditor-access";
import { createAuditLog } from "@/server/audit-log";
import { encryptCredential } from "@/lib/crypto/credentials";
import { invalidateProviderCache } from "@/lib/ai/resolveProvider";

export const settingsRouter = createTRPCRouter({
  session: orgProcedure.query(async ({ ctx }) => {
    return {
      ...ctx.session.user,
      expires: ctx.session.expires,
    };
  }),

  organization: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.organization.findUnique({
      where: {
        id: ctx.session.user.organizationId
      },
      include: {
        _count: {
          select: {
            users: true,
            frameworks: true,
            policies: true,
            evidences: true
          }
        }
      }
    });
  }),

  createAuditorKey: adminProcedure
    .input(z.object({
      duration: z.enum(["1d", "7d", "30d"])
    }))
    .mutation(async ({ ctx, input }) => {
      const exchangeCode = generateAuditorExchangeCode();
      const tokenHash = hashAuditorToken(exchangeCode);
      
      const durationMs = 
        input.duration === "1d" ? 24 * 60 * 60 * 1000 :
        input.duration === "7d" ? 7 * 24 * 60 * 60 * 1000 :
        30 * 24 * 60 * 60 * 1000;
        
      const expiresAt = new Date(Date.now() + durationMs);

      await ctx.prisma.auditorAccess.create({
        data: {
          organizationId: ctx.session.user.organizationId,
          tokenHash,
          expiresAt,
          isActive: true
        }
      });

      return { url: `/audit/auth?code=${exchangeCode}` };
    }),

  // ── Phase 2 Feature 1: Per-org AI provider config ───────────────────────────

  /**
   * Get the current AI provider config for the org.
   * The encryptedApiKey is NEVER returned — only presence is indicated.
   */
  getAIConfig: adminProcedure.query(async ({ ctx }) => {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.session.user.organizationId },
      select: { aiProvider: true },
    });

    const config = org?.aiProvider as Record<string, unknown> | null;
    if (!config) return { mode: "local-ollama" as const };

    // Mask the encrypted key — never expose it
    return {
      mode: config.mode as string,
      ...(config.model ? { model: config.model } : {}),
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      hasApiKey: !!config.encryptedApiKey,
    };
  }),

  /**
   * Update the AI provider config for the org.
   * apiKey is encrypted before storage.
   */
  updateAIConfig: adminProcedure
    .input(
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("local-ollama"), model: z.string().optional(), embeddingModel: z.string().optional() }),
        z.object({ mode: z.literal("local-small"), model: z.string().min(1), baseUrl: z.string().url().optional() }),
        z.object({
          mode: z.literal("remote-opt-in"),
          baseUrl: z.string().url(),
          model: z.string().min(1),
          apiKey: z.string().min(1),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      let aiProvider: any;

      if (input.mode === "local-ollama") {
        aiProvider = { mode: "local-ollama", ...(input.model ? { model: input.model } : {}), ...(input.embeddingModel ? { embeddingModel: input.embeddingModel } : {}) };
      } else if (input.mode === "local-small") {
        aiProvider = { mode: "local-small", model: input.model, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}) };
      } else {
        aiProvider = {
          mode: "remote-opt-in",
          baseUrl: input.baseUrl,
          model: input.model,
          encryptedApiKey: encryptCredential(input.apiKey),
        };
      }

      await ctx.prisma.organization.update({
        where: { id: organizationId },
        data: { aiProvider },
      });

      // Invalidate the per-org provider cache so next job picks up the new config
      invalidateProviderCache(organizationId);

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "AI_CONFIG_UPDATED",
        entity: "Organization",
        entityId: organizationId,
        changes: { mode: input.mode, ...(input.mode !== "local-ollama" ? { model: input.model } : {}) },
      });

      return { updated: true };
    }),
});

