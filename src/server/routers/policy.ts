import { PolicyType } from "@prisma/client";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";

export const policyRouter = createTRPCRouter({
  list: orgProcedure.query(async ({ ctx }) => {
    return ctx.prisma.policy.findMany({
      where: {
        organizationId: ctx.session.user.organizationId
      },
      orderBy: [{ updatedAt: "desc" }]
    });
  }),

  create: managerProcedure
    .input(
      z.object({
        title: z.string().min(3).max(160),
        content: z.string().min(10),
        policyType: z.nativeEnum(PolicyType),
        isPublished: z.boolean().default(false)
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const policy = await ctx.prisma.policy.create({
        data: {
          ...input,
          organizationId: ctx.session.user.organizationId
        }
      });

      await createAuditLog(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "POLICY_CREATED",
        entity: "Policy",
        entityId: policy.id,
        changes: input
      });

      return policy;
    })
});
