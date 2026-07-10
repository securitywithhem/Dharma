import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { createAuditLog } from "@/server/audit-log";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/server/lib/crypto/webhookVault";
import { checkRateLimit } from "@/server/lib/rateLimit";
import { enqueueWebhookDelivery } from "@/server/queue/webhookQueue";

const ALLOWED_EVENTS = ["evidence.updated", "control.failed"] as const;

const eventsSchema = z
  .array(z.enum(ALLOWED_EVENTS))
  .min(1, "Select at least one event to subscribe to.");

// Reject non-HTTPS webhook URLs at validation time — an unencrypted endpoint
// would expose the signed payload (and, over an untrusted network, leak
// enough context to be useful to an attacker) in transit.
const urlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), "Webhook URL must use HTTPS.");

function redactSecret(secret: string): string {
  const last4 = secret.slice(-4);
  return `••••${last4}`;
}

async function loadOrgScopedWebhook(prisma: any, id: string, organizationId: string) {
  const webhook = await prisma.webhook.findFirst({ where: { id, organizationId } });
  if (!webhook) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found." });
  }
  return webhook;
}

export const webhookRouter = createTRPCRouter({
  list: orgProcedure.query(async ({ ctx }) => {
    const webhooks = await ctx.prisma.webhook.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: "desc" },
    });

    // Never return the encrypted secret blob to the client — only a
    // redacted preview computed from the decrypted value server-side.
    const { decryptWebhookSecret } = await import("@/server/lib/crypto/webhookVault");
    return webhooks.map((webhook: any) => ({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      isActive: webhook.isActive,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      secretPreview: redactSecret(decryptWebhookSecret(webhook.secret)),
    }));
  }),

  create: managerProcedure
    .input(z.object({ url: urlSchema, events: eventsSchema }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Server-generated, crypto-random signing secret — never accepted as
      // user-supplied plaintext. Shown to the client exactly once, in this
      // mutation's response; every subsequent read (webhook.list) only
      // returns a redacted preview.
      const secret = crypto.randomBytes(32).toString("base64url");

      const webhook = await ctx.prisma.webhook.create({
        data: {
          organizationId,
          url: input.url,
          events: input.events,
          secret: encryptWebhookSecret(secret),
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WEBHOOK_CREATED",
        entity: "Webhook",
        entityId: webhook.id,
        changes: { url: input.url, events: input.events },
      });

      return {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        isActive: webhook.isActive,
        createdAt: webhook.createdAt,
        secret, // shown once
      };
    }),

  update: managerProcedure
    .input(
      z.object({
        id: z.string(),
        url: urlSchema.optional(),
        events: eventsSchema.optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await loadOrgScopedWebhook(ctx.prisma, input.id, organizationId);

      const updateData: any = {};
      if (input.url !== undefined) updateData.url = input.url;
      if (input.events !== undefined) updateData.events = input.events;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      const updated = await ctx.prisma.webhook.update({
        where: { id: input.id },
        data: updateData,
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WEBHOOK_UPDATED",
        entity: "Webhook",
        entityId: input.id,
        changes: updateData,
      });

      return {
        id: updated.id,
        url: updated.url,
        events: updated.events,
        isActive: updated.isActive,
        updatedAt: updated.updatedAt,
      };
    }),

  delete: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await loadOrgScopedWebhook(ctx.prisma, input.id, organizationId);

      await ctx.prisma.webhook.delete({ where: { id: input.id } });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WEBHOOK_DELETED",
        entity: "Webhook",
        entityId: input.id,
        changes: {},
      });

      return { deleted: true };
    }),

  testDeliver: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      checkRateLimit(`${organizationId}:webhook.testDeliver`, 10, 60_000);

      const webhook = await loadOrgScopedWebhook(ctx.prisma, input.id, organizationId);

      const jobId = await enqueueWebhookDelivery({
        webhookId: webhook.id,
        event: "webhook.test",
        payload: { message: "This is a test event from Dharma.", triggeredAt: new Date().toISOString() },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "WEBHOOK_TEST_TRIGGERED",
        entity: "Webhook",
        entityId: input.id,
        changes: { jobId },
      });

      return { jobId };
    }),

  listDeliveries: orgProcedure
    .input(z.object({ webhookId: z.string(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      await loadOrgScopedWebhook(ctx.prisma, input.webhookId, organizationId);

      return ctx.prisma.webhookDelivery.findMany({
        where: { webhookId: input.webhookId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),
});
