import { TRPCError } from "@trpc/server";
import { prisma } from "@/server/db";
import { PrismaClient } from "@prisma/client";

export type ResourceType = "users" | "frameworks" | "storageMb";

export const FREE_TIER_LIMITS = {
  users: 5,
  frameworks: 3,
  storageMb: 100, // 100 MB
};

export const FREE_TIER_FEATURES = {
  apiAccess: false,
  sso: false,
  aiAdvisor: false,
};

export class EntitlementService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retrieves the current limits and features for an organization based on its plan.
   * Defaults to Free tier limits if no plan is associated.
   */
  async getEntitlements(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });

    if (!org) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
    }

    if (!org.plan) {
      return {
        limits: FREE_TIER_LIMITS,
        features: FREE_TIER_FEATURES,
      };
    }

    const limits = org.plan.limits as Record<string, number>;
    const features = (org.plan.features || {}) as Record<string, boolean>;

    return {
      limits: {
        users: limits.users ?? FREE_TIER_LIMITS.users,
        frameworks: limits.frameworks ?? FREE_TIER_LIMITS.frameworks,
        storageMb: limits.storageMb ?? FREE_TIER_LIMITS.storageMb,
      },
      features: {
        apiAccess: features.apiAccess ?? FREE_TIER_FEATURES.apiAccess,
        sso: features.sso ?? FREE_TIER_FEATURES.sso,
        aiAdvisor: features.aiAdvisor ?? FREE_TIER_FEATURES.aiAdvisor,
      },
    };
  }

  /**
   * Checks current usage for a specific resource type within an organization.
   */
  async getUsage(organizationId: string, resource: ResourceType): Promise<number> {
    switch (resource) {
      case "users":
        return this.prisma.user.count({
          where: { organizationId },
        });

      case "frameworks":
        return this.prisma.framework.count({
          where: { organizationId },
        });

      case "storageMb":
        const result = await this.prisma.evidence.aggregate({
          where: { organizationId },
          _sum: { fileSizeBytes: true },
        });
        const totalBytes = result._sum.fileSizeBytes || 0;
        return totalBytes / (1024 * 1024); // Convert bytes to MB

      default:
        return 0;
    }
  }

  /**
   * Checks if an organization has capacity for an incoming action.
   * Throws a FORBIDDEN error if the limit is exceeded.
   */
  async checkUsageLimit(organizationId: string, resource: ResourceType, incrementAmount: number = 1) {
    const entitlements = await this.getEntitlements(organizationId);
    const limit = entitlements.limits[resource];

    // Unlimited
    if (limit === -1) {
      return true;
    }

    const currentUsage = await this.getUsage(organizationId, resource);
    
    // Check if adding the increment will exceed the limit
    if (currentUsage + incrementAmount > limit) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Plan limit exceeded for ${resource}. Current usage: ${currentUsage.toFixed(2)}, Limit: ${limit}. Please upgrade your plan.`,
      });
    }

    return true;
  }

  /**
   * Checks if an organization has access to a specific feature.
   * Throws a FORBIDDEN error if the feature is not enabled.
   */
  async checkFeature(organizationId: string, featureKey: keyof typeof FREE_TIER_FEATURES) {
    const entitlements = await this.getEntitlements(organizationId);
    const isEnabled = entitlements.features[featureKey];

    if (!isEnabled) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `The feature '${featureKey}' is not available on your current plan. Please upgrade to access this feature.`,
      });
    }

    return true;
  }
}
