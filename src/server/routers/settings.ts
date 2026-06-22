import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";
import { z } from "zod";
import crypto from "crypto";
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
      const token = crypto.randomBytes(32).toString("hex");
      
      const durationMs = 
        input.duration === "1d" ? 24 * 60 * 60 * 1000 :
        input.duration === "7d" ? 7 * 24 * 60 * 60 * 1000 :
        30 * 24 * 60 * 60 * 1000;
        
      const expiresAt = new Date(Date.now() + durationMs);

      await ctx.prisma.auditorAccess.create({
        data: {
          organizationId: ctx.session.user.organizationId,
          token,
          expiresAt,
          isActive: true
        }
      });

      return { url: `/audit/auth?token=${token}` };
    })
});
