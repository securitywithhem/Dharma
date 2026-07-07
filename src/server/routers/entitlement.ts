import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { EntitlementService } from "@/server/services/entitlement";
import { z } from "zod";

export const entitlementRouter = createTRPCRouter({
  /**
   * Fetch current limits, features, and usage for the organization.
   */
  getDashboard: orgProcedure.query(async ({ ctx }) => {
    const entitlementService = new EntitlementService(ctx.prisma);
    const orgId = ctx.session.user.organizationId;
    
    const [entitlements, usersUsage, frameworksUsage, storageUsage] = await Promise.all([
      entitlementService.getEntitlements(orgId),
      entitlementService.getUsage(orgId, "users"),
      entitlementService.getUsage(orgId, "frameworks"),
      entitlementService.getUsage(orgId, "storageMb"),
    ]);

    return {
      planName: (entitlements as any)?.plan?.name || "free",
      limits: entitlements.limits as any,
      features: entitlements.features as any,
      currentUsage: {
        users: usersUsage,
        frameworks: frameworksUsage,
        storageMb: storageUsage,
      },
    };
  }),
});
