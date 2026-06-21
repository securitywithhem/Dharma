import { createTRPCRouter, adminProcedure, orgProcedure } from "@/server/trpc";

export const settingsRouter = createTRPCRouter({
  session: orgProcedure.query(async ({ ctx }) => {
    return ctx.session.user;
  }),

  organization: adminProcedure.query(async ({ ctx }) => {
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
  })
});
