// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  SECURITY-CRITICAL: DELIBERATE TENANT-ISOLATION (RLS) BYPASS           ║
// ║                                                                        ║
// ║  This file is the ONLY place in the codebase permitted to construct   ║
// ║  queries spanning multiple organizationId values without the standard ║
// ║  per-org session scoping. Every function here MUST:                   ║
// ║    1. Re-validate the MsspGrant from the DATABASE on every call       ║
// ║       (never trust a grant object passed across a session boundary),  ║
// ║       checking grantedUserId === session user, revokedAt is null,     ║
// ║       and expiresAt has not passed.                                   ║
// ║    2. Query ONLY grant.scopeOrgIds — never group.organizations —      ║
// ║       so adding an org to a group later never silently widens an      ║
// ║       existing grant.                                                 ║
// ║    3. Emit a detailed AuditEvent (which orgs, by whom, how many       ║
// ║       results) for every single aggregate view. No exceptions.        ║
// ║                                                                        ║
// ║  Code-review checklist item: any new multi-org query added anywhere   ║
// ║  else in src/ is a defect — move it here or reject the change.        ║
// ║  (Enforced by tests/phase8-tenant-isolation: static sweep.)           ║
// ╚═══════════════════════════════════════════════════════════════════════╝
//
// Trust model note (flagged in the Phase 8 report): parent-org admins with
// mssp.manageGrants create grants over their client orgs, so the MSSP org
// self-serves scope. The grant still adds real controls the docs' role-only
// design lacked: an explicit allow-list, expiry, instant revocation, and a
// per-call audit trail.
import type { MsspGrant, PrismaClient } from "@prisma/client";
import { emitAuditEvent } from "@/server/services/audit/writer";

export class MsspGrantError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "EXPIRED" | "REVOKED",
  ) {
    super(message);
  }
}

/**
 * Loads and validates a grant fresh from the DB. Returns the validated grant.
 * Deliberately re-run on EVERY aggregate/drill-down call — revocation and
 * expiry take effect immediately, with no session-cached bypass.
 */
export async function loadValidGrant(
  prisma: PrismaClient,
  grantId: string,
  sessionUserId: string,
): Promise<MsspGrant> {
  const grant = await prisma.msspGrant.findUnique({ where: { id: grantId } });
  if (!grant) {
    throw new MsspGrantError("Grant not found.", "NOT_FOUND");
  }
  if (grant.grantedUserId !== sessionUserId) {
    // Do not reveal whether the grant exists for someone else.
    throw new MsspGrantError("Grant not found.", "NOT_FOUND");
  }
  if (grant.revokedAt) {
    throw new MsspGrantError("This grant has been revoked.", "REVOKED");
  }
  if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
    throw new MsspGrantError("This grant has expired.", "EXPIRED");
  }
  return grant;
}

async function auditAggregateView(
  prisma: PrismaClient,
  grant: MsspGrant,
  actorUserId: string,
  actorOrgId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await emitAuditEvent(prisma, {
    // Recorded against the MSSP's own org — the actor's home tenant owns
    // the accountability trail for its cross-tenant reads.
    organizationId: actorOrgId,
    userId: actorUserId,
    action,
    entity: "MsspGrant",
    entityId: grant.id,
    changes: { scopeOrgIds: grant.scopeOrgIds, groupId: grant.groupId, ...metadata },
  });
}

export type ClientComplianceSummary = {
  organizationId: string;
  organizationName: string;
  complianceScore: number | null; // % implemented controls, null when no controls
  totalControls: number;
  compliantControls: number;
  openVulnerabilities: number;
  lastAuditAt: Date | null;
};

/**
 * Aggregate compliance tiles for the MSSP dashboard (App Flow journey 7
 * step 2; UI_UX "Multi-org health tiles": compliance score, open vulns,
 * last audit date).
 */
export async function getAggregateComplianceScores(
  prisma: PrismaClient,
  grantId: string,
  sessionUser: { id: string; organizationId: string },
): Promise<ClientComplianceSummary[]> {
  const grant = await loadValidGrant(prisma, grantId, sessionUser.id);
  const scopeOrgIds = grant.scopeOrgIds;
  if (scopeOrgIds.length === 0) return [];

  // ---- cross-org reads below: bounded strictly by scopeOrgIds ----
  const [orgs, controlsByOrg, implementedByOrg, vulnsByOrg, lastAudits] =
    await Promise.all([
      prisma.organization.findMany({
        where: { id: { in: scopeOrgIds } },
        select: { id: true, name: true },
      }),
      prisma.control.groupBy({
        by: ["frameworkId"],
        where: { framework: { organizationId: { in: scopeOrgIds } } },
        _count: { _all: true },
      }),
      prisma.control.groupBy({
        by: ["frameworkId"],
        where: {
          framework: { organizationId: { in: scopeOrgIds } },
          status: "COMPLIANT",
        },
        _count: { _all: true },
      }),
      prisma.vulnerability.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: scopeOrgIds }, status: { in: ["OPEN", "IN_PROGRESS"] } },
        _count: { _all: true },
      }),
      prisma.auditLog.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: scopeOrgIds } },
        _max: { timestamp: true },
      }),
    ]);

  // Framework → org mapping for the control tallies.
  const frameworks = await prisma.framework.findMany({
    where: { organizationId: { in: scopeOrgIds } },
    select: { id: true, organizationId: true },
  });
  const frameworkOrg = new Map(frameworks.map((f) => [f.id, f.organizationId]));

  const totals = new Map<string, number>();
  for (const row of controlsByOrg) {
    const orgId = frameworkOrg.get(row.frameworkId);
    if (orgId) totals.set(orgId, (totals.get(orgId) ?? 0) + row._count._all);
  }
  const implemented = new Map<string, number>();
  for (const row of implementedByOrg) {
    const orgId = frameworkOrg.get(row.frameworkId);
    if (orgId) implemented.set(orgId, (implemented.get(orgId) ?? 0) + row._count._all);
  }
  const vulns = new Map(vulnsByOrg.map((v) => [v.organizationId, v._count._all]));
  const audits = new Map(lastAudits.map((a) => [a.organizationId, a._max.timestamp]));

  const summaries = orgs.map((org) => {
    const total = totals.get(org.id) ?? 0;
    const done = implemented.get(org.id) ?? 0;
    return {
      organizationId: org.id,
      organizationName: org.name,
      complianceScore: total > 0 ? Math.round((done / total) * 100) : null,
      totalControls: total,
      compliantControls: done,
      openVulnerabilities: vulns.get(org.id) ?? 0,
      lastAuditAt: audits.get(org.id) ?? null,
    };
  });

  await auditAggregateView(
    prisma,
    grant,
    sessionUser.id,
    sessionUser.organizationId,
    "MSSP_AGGREGATE_VIEWED",
    { resultOrgCount: summaries.length, view: "complianceScores" },
  );

  return summaries;
}

export type AggregateVulnerabilityRow = {
  organizationId: string;
  organizationName: string;
  severity: string;
  count: number;
};

export async function getAggregateVulnerabilities(
  prisma: PrismaClient,
  grantId: string,
  sessionUser: { id: string; organizationId: string },
): Promise<AggregateVulnerabilityRow[]> {
  const grant = await loadValidGrant(prisma, grantId, sessionUser.id);
  if (grant.scopeOrgIds.length === 0) return [];

  const [rows, orgs] = await Promise.all([
    prisma.vulnerability.groupBy({
      by: ["organizationId", "severity"],
      where: {
        organizationId: { in: grant.scopeOrgIds },
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      _count: { _all: true },
    }),
    prisma.organization.findMany({
      where: { id: { in: grant.scopeOrgIds } },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map(orgs.map((o) => [o.id, o.name]));

  await auditAggregateView(
    prisma,
    grant,
    sessionUser.id,
    sessionUser.organizationId,
    "MSSP_AGGREGATE_VIEWED",
    { resultOrgCount: orgs.length, view: "vulnerabilities" },
  );

  return rows.map((row) => ({
    organizationId: row.organizationId,
    organizationName: names.get(row.organizationId) ?? row.organizationId,
    severity: row.severity,
    count: row._count._all,
  }));
}

/**
 * Consolidated multi-client report (App Flow journey 7 step 3). Reuses the
 * aggregate summaries rather than a bespoke reporting path; returned as
 * structured data the router turns into a CSV in MinIO (the established
 * export mechanism — the PDF utilities in src/lib/pdf are React-PDF
 * dashboards, reusing exportCsv-style delivery is the smaller change).
 */
export async function generateConsolidatedReport(
  prisma: PrismaClient,
  grantId: string,
  sessionUser: { id: string; organizationId: string },
): Promise<{ generatedAt: string; clients: ClientComplianceSummary[] }> {
  const clients = await getAggregateComplianceScores(prisma, grantId, sessionUser);
  const grant = await loadValidGrant(prisma, grantId, sessionUser.id);

  await auditAggregateView(
    prisma,
    grant,
    sessionUser.id,
    sessionUser.organizationId,
    "MSSP_CONSOLIDATED_REPORT_GENERATED",
    { resultOrgCount: clients.length },
  );

  return { generatedAt: new Date().toISOString(), clients };
}
