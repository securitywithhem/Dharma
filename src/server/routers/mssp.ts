// Phase 8 Part 3 — MSSP operations router.
//
// Access model (three independent gates, all required):
//   1. requirePermission("mssp.viewAllClients") — RBAC (Part 1).
//   2. A valid MsspGrant (unexpired, unrevoked, granted to THIS user) —
//      re-validated from the DB on every call by aggregateQuery.service.
//   3. For drill-down: the target org must be in the grant's scopeOrgIds;
//      the queries then run through the STANDARD single-org scoping with
//      the validated target orgId — the bypass layer is only for aggregates.
//
// Grant management (createGrant/revokeGrant) is restricted to admins of the
// group's parent org via mssp.manageGrants.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";
import {
  loadValidGrant,
  getAggregateComplianceScores,
  getAggregateVulnerabilities,
  generateConsolidatedReport,
  MsspGrantError,
} from "@/server/services/mssp/aggregateQuery.service";
import { putObject, generatePresignedDownloadUrl } from "@/server/minio";

function grantErrorToTrpc(error: unknown): never {
  if (error instanceof MsspGrantError) {
    throw new TRPCError({
      code: error.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
      message: error.message,
    });
  }
  throw error;
}

export const msspRouter = createTRPCRouter({
  /** Groups where the caller holds an active, unexpired, unrevoked grant. */
  myGroups: permissionProcedure("mssp.viewAllClients").query(async ({ ctx }) => {
    const grants = await ctx.prisma.msspGrant.findMany({
      where: {
        grantedUserId: ctx.session.user.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: { group: { select: { id: true, name: true, parentOrgId: true } } },
      orderBy: { createdAt: "desc" },
    });
    return grants.map((grant) => ({
      grantId: grant.id,
      group: grant.group,
      scopeOrgCount: grant.scopeOrgIds.length,
      expiresAt: grant.expiresAt,
    }));
  }),

  /** Health tiles for every client org the grant covers. */
  clientOverview: permissionProcedure("mssp.viewAllClients")
    .input(z.object({ grantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getAggregateComplianceScores(ctx.prisma, input.grantId, {
          id: ctx.session.user.id,
          organizationId: ctx.session.user.organizationId,
        });
      } catch (error) {
        grantErrorToTrpc(error);
      }
    }),

  aggregateVulnerabilities: permissionProcedure("mssp.viewAllClients")
    .input(z.object({ grantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getAggregateVulnerabilities(ctx.prisma, input.grantId, {
          id: ctx.session.user.id,
          organizationId: ctx.session.user.organizationId,
        });
      } catch (error) {
        grantErrorToTrpc(error);
      }
    }),

  /**
   * Drill-down into ONE client org. The grant is re-validated on every call
   * (no session-cached bypass) and must explicitly list the target org; the
   * data queries below are ordinary single-org-scoped reads against the
   * validated orgId — NOT the multi-org aggregate path.
   */
  drillDown: permissionProcedure("mssp.viewAllClients")
    .input(z.object({ grantId: z.string().min(1), orgId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      let grant;
      try {
        grant = await loadValidGrant(ctx.prisma, input.grantId, ctx.session.user.id);
      } catch (error) {
        grantErrorToTrpc(error);
      }
      if (!grant.scopeOrgIds.includes(input.orgId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This grant does not cover the requested organization.",
        });
      }

      // Audited separately from aggregate views: which single org was opened.
      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MSSP_DRILLDOWN_VIEWED",
        entity: "Organization",
        entityId: input.orgId,
        changes: { grantId: grant.id },
      });

      const orgId = input.orgId; // validated above — standard scoping below
      const [org, frameworks, vulnBySeverity, recentAudit] = await Promise.all([
        ctx.prisma.organization.findUnique({
          where: { id: orgId },
          select: { id: true, name: true, createdAt: true },
        }),
        ctx.prisma.framework.findMany({
          where: { organizationId: orgId },
          select: {
            id: true,
            name: true,
            _count: { select: { controls: true } },
            controls: { where: { status: "COMPLIANT" }, select: { id: true } },
          },
        }),
        ctx.prisma.vulnerability.groupBy({
          by: ["severity"],
          where: { organizationId: orgId, status: { in: ["OPEN", "IN_PROGRESS"] } },
          _count: { _all: true },
        }),
        ctx.prisma.auditLog.findFirst({
          where: { organizationId: orgId },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true, action: true },
        }),
      ]);

      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      return {
        organization: org,
        frameworks: frameworks.map((f) => ({
          id: f.id,
          name: f.name,
          totalControls: f._count.controls,
          compliantControls: f.controls.length,
        })),
        openVulnerabilities: vulnBySeverity.map((v) => ({
          severity: v.severity,
          count: v._count._all,
        })),
        lastAudit: recentAudit,
      };
    }),

  generateConsolidatedReport: permissionProcedure("mssp.viewAllClients")
    .input(z.object({ grantId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let report;
      try {
        report = await generateConsolidatedReport(ctx.prisma, input.grantId, {
          id: ctx.session.user.id,
          organizationId: ctx.session.user.organizationId,
        });
      } catch (error) {
        grantErrorToTrpc(error);
      }

      const escape = (value: unknown) => {
        let text = value == null ? "" : String(value);
        // Formula-injection guard: a leading = + - @ executes in Excel/Sheets.
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const csv = [
        "organization,complianceScore,totalControls,compliantControls,openVulnerabilities,lastAuditAt",
        ...report.clients.map((client) =>
          [
            client.organizationName,
            client.complianceScore ?? "n/a",
            client.totalControls,
            client.compliantControls,
            client.openVulnerabilities,
            client.lastAuditAt?.toISOString() ?? "never",
          ]
            .map(escape)
            .join(","),
        ),
      ].join("\n");

      const objectName = `${ctx.session.user.organizationId}/mssp-reports/${Date.now()}-consolidated.csv`;
      await putObject(objectName, csv, "text/csv");
      const downloadUrl = await generatePresignedDownloadUrl(objectName, 15 * 60);
      return { downloadUrl, clientCount: report.clients.length };
    }),

  // ── Group & grant management (parent-org admins) ─────────────────────────

  createGroup: permissionProcedure("mssp.manageGrants")
    .input(z.object({ name: z.string().trim().min(2).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.organizationGroup.create({
        data: { name: input.name, parentOrgId: ctx.session.user.organizationId },
      });
      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MSSP_GROUP_CREATED",
        entity: "OrganizationGroup",
        entityId: group.id,
        changes: { name: input.name },
      });
      return group;
    }),

  listGroups: permissionProcedure("mssp.manageGrants").query(async ({ ctx }) => {
    return ctx.prisma.organizationGroup.findMany({
      where: { parentOrgId: ctx.session.user.organizationId },
      include: {
        organizations: { select: { id: true, name: true } },
        grants: {
          where: { revokedAt: null },
          select: { id: true, grantedUserId: true, scopeOrgIds: true, expiresAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  createGrant: permissionProcedure("mssp.manageGrants")
    .input(
      z.object({
        groupId: z.string().min(1),
        grantedUserId: z.string().min(1),
        scopeOrgIds: z.array(z.string().min(1)).min(1).max(500),
        expiresAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only the group's own parent org can mint grants for it.
      const group = await ctx.prisma.organizationGroup.findFirst({
        where: { id: input.groupId, parentOrgId: ctx.session.user.organizationId },
        include: { organizations: { select: { id: true } } },
      });
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found." });
      }

      // Grantee must be a member of the MSSP's own (parent) org.
      const grantee = await ctx.prisma.user.findFirst({
        where: {
          id: input.grantedUserId,
          organizationId: ctx.session.user.organizationId,
          isActive: true,
        },
      });
      if (!grantee) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Grantee must be an active member of your organization.",
        });
      }

      // The allow-list may only reference orgs actually in this group.
      const groupOrgIds = new Set(group.organizations.map((o) => o.id));
      const outside = input.scopeOrgIds.filter((id) => !groupOrgIds.has(id));
      if (outside.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Org(s) not in this group: ${outside.join(", ")}`,
        });
      }
      if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "expiresAt must be in the future.",
        });
      }

      const grant = await ctx.prisma.msspGrant.create({
        data: {
          groupId: group.id,
          grantedUserId: grantee.id,
          scopeOrgIds: input.scopeOrgIds,
          expiresAt: input.expiresAt ?? null,
        },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MSSP_GRANT_CREATED",
        entity: "MsspGrant",
        entityId: grant.id,
        changes: {
          grantedUserId: grantee.id,
          scopeOrgIds: input.scopeOrgIds,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          severity: "HIGH", // cross-tenant access provisioned
        },
      });

      return grant;
    }),

  revokeGrant: permissionProcedure("mssp.manageGrants")
    .input(z.object({ grantId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const grant = await ctx.prisma.msspGrant.findFirst({
        where: {
          id: input.grantId,
          group: { parentOrgId: ctx.session.user.organizationId },
        },
      });
      if (!grant) throw new TRPCError({ code: "NOT_FOUND" });
      if (grant.revokedAt) return { revoked: true, alreadyRevoked: true };

      await ctx.prisma.msspGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date() },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "MSSP_GRANT_REVOKED",
        entity: "MsspGrant",
        entityId: grant.id,
        changes: { grantedUserId: grant.grantedUserId, severity: "HIGH" },
      });

      return { revoked: true, alreadyRevoked: false };
    }),
});
