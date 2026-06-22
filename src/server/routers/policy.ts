import { PolicyType } from "@prisma/client";
import { z } from "zod";
import { createAuditLog } from "@/server/audit-log";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { policyQueue } from "@/workers/policy";
import { Job } from "bullmq";

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
    }),

  triggerAIGeneration: managerProcedure
    .input(
      z.object({
        policyType: z.nativeEnum(PolicyType),
        context: z.string().min(10).max(2000)
      })
    )
    .mutation(async ({ input }) => {
      const job = await policyQueue.add("generate", {
        policyType: input.policyType,
        context: input.context
      });
      return { jobId: job.id };
    }),

  getGenerationStatus: managerProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = await Job.fromId(policyQueue, input.jobId);
      
      if (!job) {
        return { status: "not_found" };
      }

      const state = await job.getState();
      
      if (state === "completed") {
        return { status: "completed", result: job.returnvalue as string };
      }
      
      if (state === "failed") {
        return { status: "failed", error: job.failedReason };
      }

      return { status: "active" };
    })
});
