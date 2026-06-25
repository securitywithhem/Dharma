import { createTRPCRouter, orgProcedure } from '../trpc';

export interface DashboardStats {
  overallScore: number;
  totalControls: number;
  compliantControls: number;
  inProgressControls: number;
  notStartedControls: number;
  frameworks: Array<{
    id: string;
    name: string;
    version: string;
    progress: number;
    controlCount: number;
    compliantCount: number;
  }>;
  domains: Array<{
    name: string;
    controlCount: number;
    compliantCount: number;
    evidenceCount: number;
    policyCount: number;
    completionPercentage: number;
    gap: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entity: string;
    timestamp: Date;
    userName?: string;
  }>;
  topIncompleteControls: Array<{
    id: string;
    title: string;
    frameworkName: string;
    domain: string;
    status: string;
    evidenceCount: number;
  }>;
}

// In Prisma, controls from findMany with include are properly typed, but for the map we need a precise type
// that includes the nested relation. We can use Prisma.ControlGetPayload if needed, or simply extract from the result.
type ControlWithEvidence = {
  id: string;
  domain: string;
  status: string;
  title: string;
  evidence: { id: string }[];
};

export const dashboardRouter = createTRPCRouter({
  /**
   * Get comprehensive dashboard statistics for the organization.
   */
  getStats: orgProcedure.query(async ({ ctx }) => {
    const { prisma, session } = ctx;
    const organizationId = session.user.organizationId!;

    // Fetch all frameworks
    const frameworks = await prisma.framework.findMany({
      where: { organizationId },
      include: {
        controls: {
          include: {
            evidence: { select: { id: true } },
          },
        },
      },
    });

    // Calculate framework metrics
    const frameworkStats = frameworks.map((fw) => {
      const compliantCount = fw.controls.filter(
        (c) => c.status === 'COMPLIANT'
      ).length;
      const progress =
        fw.controls.length > 0
          ? Math.round((compliantCount / fw.controls.length) * 100)
          : 0;

      return {
        id: fw.id,
        name: fw.name,
        version: fw.version,
        progress,
        controlCount: fw.controls.length,
        compliantCount,
      };
    });

    // Calculate overall metrics
    const totalControls = frameworks.reduce(
      (sum, fw) => sum + fw.controls.length,
      0
    );
    const compliantControls = frameworks.reduce((sum, fw) => {
      return (
        sum +
        fw.controls.filter((c) => c.status === 'COMPLIANT').length
      );
    }, 0);
    const inProgressControls = frameworks.reduce((sum, fw) => {
      return (
        sum +
        fw.controls.filter((c) => c.status === 'IN_PROGRESS').length
      );
    }, 0);
    const notStartedControls = totalControls - compliantControls - inProgressControls;

    const overallScore =
      totalControls > 0 ? Math.round((compliantControls / totalControls) * 100) : 0;

    // Calculate domain-level gaps
    const domainMap = new Map<
      string,
      {
        controlIds: Set<string>;
        controls: ControlWithEvidence[];
      }
    >();

    frameworks.forEach((fw) => {
      fw.controls.forEach((control) => {
        if (!domainMap.has(control.domain)) {
          domainMap.set(control.domain, { controlIds: new Set(), controls: [] });
        }
        domainMap.get(control.domain)!.controlIds.add(control.id);
        domainMap.get(control.domain)!.controls.push(control);
      });
    });

    const domains = Array.from(domainMap.entries()).map(
      ([domainName, { controls }]) => {
        const compliantCount = controls.filter(
          (c) => c.status === 'COMPLIANT'
        ).length;
        const totalEvidenceCount = controls.reduce(
          (sum, c) => sum + c.evidence.length,
          0
        );
        const completionPercentage =
          controls.length > 0
            ? Math.round((compliantCount / controls.length) * 100)
            : 0;

        // Determine gap level
        let gap: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
        if (completionPercentage === 100) gap = 'NONE';
        else if (completionPercentage >= 75) gap = 'LOW';
        else if (completionPercentage >= 50) gap = 'MEDIUM';
        else gap = 'HIGH';

        return {
          name: domainName,
          controlCount: controls.length,
          compliantCount,
          evidenceCount: totalEvidenceCount,
          policyCount: 0, // In a future iteration we can count mapped policies
          completionPercentage,
          gap,
        };
      }
    );

    // Fetch recent activity
    const recentActivity = await prisma.auditLog.findMany({
      where: { organizationId },
      select: {
        id: true,
        action: true,
        entity: true,
        timestamp: true,
        user: { select: { name: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    // Top incomplete controls (for quick action)
    const topIncompleteControls = frameworks
      .flatMap((fw) =>
        fw.controls
          .filter((c) => c.status !== 'COMPLIANT')
          .map((c) => ({
            id: c.id,
            title: c.title,
            frameworkName: fw.name,
            domain: c.domain,
            status: c.status,
            evidenceCount: c.evidence.length,
          }))
      )
      .sort(
        (a, b) => a.evidenceCount - b.evidenceCount // Prioritize controls with no evidence
      )
      .slice(0, 5);

    return {
      overallScore,
      totalControls,
      compliantControls,
      inProgressControls,
      notStartedControls,
      frameworks: frameworkStats,
      domains,
      recentActivity: recentActivity.map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        timestamp: log.timestamp,
        userName: log.user?.name ?? undefined,
      })),
      topIncompleteControls,
    } as DashboardStats;
  }),
});
