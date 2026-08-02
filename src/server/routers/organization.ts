// Settings → Team: org member roster + role/removal management.
//
// Members are modelled as Users carrying an `organizationId` directly — there
// is no Membership join table in this schema, so "list members" is a
// tenant-scoped User query. Pending invites live in a separate
// OrganizationInvite table and are surfaced alongside active members so the
// roster reflects everyone the org has extended access to.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, orgProcedure } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";

const ROLES = ["ADMIN", "COMPLIANCE_MANAGER", "PUBLISHER", "VIEWER"] as const;

export const organizationRouter = createTRPCRouter({
  listMembers: orgProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(25),
        })
        .default({ page: 1, limit: 25 }),
    )
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const skip = (input.page - 1) * input.limit;

      const [users, total, invites] = await Promise.all([
        ctx.prisma.user.findMany({
          where: { organizationId },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            role: true,
            isActive: true,
            createdAt: true,
            customRole: { select: { id: true, name: true } },
          },
          orderBy: [{ createdAt: "asc" }],
          skip,
          take: input.limit,
        }),
        ctx.prisma.user.count({ where: { organizationId } }),
        // Only unaccepted, unexpired invites are still actionable.
        ctx.prisma.organizationInvite.findMany({
          where: {
            organizationId,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return {
        members: users.map((user) => ({
          ...user,
          // NOTE: this schema has no lastLoginAt/lastActiveAt column, so a
          // real "last active" value is not derivable. The UI shows joinedAt
          // instead rather than inventing activity data.
          joinedAt: user.createdAt,
          status: user.isActive ? ("ACTIVE" as const) : ("DEACTIVATED" as const),
        })),
        pendingInvites: invites,
        total,
        page: input.page,
        limit: input.limit,
        pageCount: Math.max(1, Math.ceil(total / input.limit)),
      };
    }),

  // Changing what a member can do is a role operation, so it is gated on
  // roles.manage rather than members.invite.
  updateMemberRole: permissionProcedure("roles.manage")
    .input(z.object({ userId: z.string(), role: z.enum(ROLES) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role.",
        });
      }

      // Scope the lookup by organizationId so a caller cannot reach a user in
      // another tenant by guessing an id.
      const target = await ctx.prisma.user.findFirst({
        where: { id: input.userId, organizationId },
        select: { id: true, role: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      // Refuse to demote the last remaining admin — otherwise the org locks
      // itself out of every admin-gated setting.
      if (target.role === "ADMIN" && input.role !== "ADMIN") {
        const adminCount = await ctx.prisma.user.count({
          where: { organizationId, role: "ADMIN", isActive: true },
        });
        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last administrator.",
          });
        }
      }

      const updated = await ctx.prisma.user.update({
        where: { id: target.id },
        data: { role: input.role },
        select: { id: true, role: true },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "MEMBER_ROLE_UPDATED",
        entity: "User",
        entityId: target.id,
        changes: { from: target.role, to: input.role },
      });

      return updated;
    }),

  removeMember: permissionProcedure("members.invite")
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself from the organization.",
        });
      }

      const target = await ctx.prisma.user.findFirst({
        where: { id: input.userId, organizationId },
        select: { id: true, email: true, role: true, isActive: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      if (target.role === "ADMIN") {
        const adminCount = await ctx.prisma.user.count({
          where: { organizationId, role: "ADMIN", isActive: true },
        });
        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last administrator.",
          });
        }
      }

      // Soft-delete, matching the SCIM deactivation convention: the row stays
      // so audit-log foreign keys and evidence attribution remain intact.
      await ctx.prisma.user.update({
        where: { id: target.id },
        data: { isActive: false },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "MEMBER_DEACTIVATED",
        entity: "User",
        entityId: target.id,
        changes: { email: target.email },
      });

      return { id: target.id };
    }),
});
