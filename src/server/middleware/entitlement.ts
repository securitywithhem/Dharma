import { TRPCError } from "@trpc/server";
import { EntitlementService, ResourceType, FREE_TIER_FEATURES } from "@/server/services/entitlement";
import { t } from "@/server/trpc";

export function createEntitlementMiddleware(resource: ResourceType, incrementAmount: number = 1) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.organizationId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No organization context found.",
      });
    }

    const entitlementService = new EntitlementService(ctx.prisma);
    
    await entitlementService.checkUsageLimit(
      ctx.session.user.organizationId,
      resource,
      incrementAmount
    );

    return next({ ctx });
  });
}

export function createFeatureGatingMiddleware(featureKey: keyof typeof FREE_TIER_FEATURES) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.organizationId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No organization context found.",
      });
    }

    const entitlementService = new EntitlementService(ctx.prisma);
    
    await entitlementService.checkFeature(
      ctx.session.user.organizationId,
      featureKey
    );

    return next({ ctx });
  });
}
