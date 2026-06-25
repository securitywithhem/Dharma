import { prisma } from '@/server/db';
import { verifyAuditChain } from '@/server/audit-log';

export interface ReportData {
  organization: {
    id: string;
    name: string;
    createdAt: Date;
  };
  reportGeneratedAt: Date;
  frameworks: Array<{
    name: string;
    version: string;
    progressPercentage: number;
    domains: Array<{
      name: string;
      controls: Array<{
        id: string;
        title: string;
        description: string;
        status: string;
        evidenceCount: number;
        evidence: Array<{
          fileName: string;
          type: string;
          collectedAt: Date;
        }>;
      }>;
    }>;
  }>;
  policies: Array<{
    title: string;
    policyType: string;
    version: number;
    isPublished: boolean;
    updatedAt: Date;
  }>;
  auditLog: Array<{
    action: string;
    entity: string;
    timestamp: Date;
    userId: string | null;
  }>;
  complianceScore: number;
  verificationStatus: 'VALID' | 'COMPROMISED' | 'UNVERIFIED';
}

/**
 * Aggregates all compliance data for a given organization into a report structure.
 * @param organizationId - The organization ID
 * @returns Complete report data object
 */
export async function aggregateReportData(
  organizationId: string
): Promise<ReportData> {
  // Fetch organization
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });

  // Fetch all frameworks with controls and evidence
  const frameworks = await prisma.framework.findMany({
    where: { organizationId },
    include: {
      controls: {
        include: {
          evidence: {
            select: {
              fileName: true,
              type: true,
              collectedAt: true,
            },
          },
        },
      },
    },
  });

  // Organize controls by domain
  const frameworksWithDomains = frameworks.map((fw) => {
    const domainMap = new Map<
      string,
      Array<(typeof fw.controls)[0]>
    >();

    fw.controls.forEach((control) => {
      if (!domainMap.has(control.domain)) {
        domainMap.set(control.domain, []);
      }
      domainMap.get(control.domain)!.push(control);
    });

    const domains = Array.from(domainMap.entries()).map(([name, controls]) => ({
      name,
      controls: controls.map((control) => ({
        id: control.id,
        title: control.title,
        description: control.description,
        status: control.status,
        evidenceCount: control.evidence.length,
        evidence: control.evidence,
      })),
    }));

    // Calculate progress
    const compliantControls = fw.controls.filter(
      (c) => c.status === 'COMPLIANT'
    ).length;
    const progressPercentage =
      fw.controls.length > 0
        ? Math.round((compliantControls / fw.controls.length) * 100)
        : 0;

    return {
      name: fw.name,
      version: fw.version,
      progressPercentage,
      domains,
    };
  });

  // Fetch policies
  const policies = await prisma.policy.findMany({
    where: { organizationId, isPublished: true },
    select: {
      title: true,
      policyType: true,
      version: true,
      isPublished: true,
      updatedAt: true,
    },
  });

  // Fetch recent audit logs (last 50 entries)
  const auditLogs = await prisma.auditLog.findMany({
    where: { organizationId },
    select: {
      action: true,
      entity: true,
      timestamp: true,
      userId: true,
    },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  // Calculate overall compliance score
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
  const complianceScore =
    totalControls > 0 ? Math.round((compliantControls / totalControls) * 100) : 0;

  // Verify audit log integrity
  const allLogsForVerification = await prisma.auditLog.findMany({
    where: { organizationId },
    orderBy: { timestamp: 'asc' },
  });
  const auditIntegrityResult = verifyAuditChain(allLogsForVerification);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt,
    },
    reportGeneratedAt: new Date(),
    frameworks: frameworksWithDomains,
    policies,
    auditLog: auditLogs,
    complianceScore,
    verificationStatus: auditIntegrityResult.ok ? 'VALID' : 'COMPROMISED',
  };
}
