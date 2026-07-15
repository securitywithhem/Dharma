// Phase 9 Part 3 — API key management router (org-admin only).
// Creates/lists/revokes keys for the public API. The plaintext key is returned
// exactly once at creation (only its SHA-256 hash is stored), matching the
// endpoint-enrollment-token pattern from Part 1.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, orgProcedure, adminProcedure } from "@/server/trpc";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { generateApiKey, hashApiKey, API_SCOPES, isApiScope } from "@/server/lib/apiKey";

export const apiKeyRouter = createTRPCRouter({
  /** Available scopes for the create-key UI. */
  scopes: orgProcedure.query(() => [...API_SCOPES]),

  list: orgProcedure.query(async ({ ctx }) => {
    const keys = await ctx.prisma.apiKey.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: "desc" },
      // keyHash is deliberately never selected.
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return keys;
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(2).max(120),
        scopes: z.array(z.string()).min(1).superRefine((scopes, ctx) => {
          for (const s of scopes) {
            if (!isApiScope(s)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown scope: ${s}` });
            }
          }
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const { token, keyPrefix } = generateApiKey();

      const apiKey = await ctx.prisma.apiKey.create({
        data: {
          organizationId,
          name: input.name,
          keyHash: hashApiKey(token),
          keyPrefix,
          scopes: input.scopes,
          createdById: ctx.session.user.id,
        },
        select: { id: true, name: true, keyPrefix: true, scopes: true, createdAt: true },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "API_KEY_CREATED",
        entity: "ApiKey",
        entityId: apiKey.id,
        // Never the token — only non-secret metadata.
        changes: { name: input.name, scopes: input.scopes, keyPrefix },
      });

      // Plaintext returned exactly once — never retrievable again.
      return { ...apiKey, token };
    }),

  revoke: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const key = await ctx.prisma.apiKey.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!key) throw new TRPCError({ code: "NOT_FOUND" });
      if (key.revokedAt) return { id: key.id, alreadyRevoked: true };

      await ctx.prisma.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
      });
      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "API_KEY_REVOKED",
        entity: "ApiKey",
        entityId: key.id,
        changes: { name: key.name, keyPrefix: key.keyPrefix },
      });
      return { id: key.id, alreadyRevoked: false };
    }),
});
