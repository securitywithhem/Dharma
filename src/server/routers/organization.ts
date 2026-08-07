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
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/server/lib/sessionPolicy";

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
      //
      // GH #22 — the same write also stamps the session cutoff. `isActive:
      // false` is already refused by orgProcedure, so this is belt-and-braces
      // for the offboarding path rather than the only thing stopping them; it
      // matters because it means the departure leaves a *timestamp* on the row
      // saying when their sessions were cut, which is the artefact an auditor
      // testing access-revocation asks for. Reactivating the user later does
      // not resurrect the old token, because the cutoff stays put.
      await ctx.prisma.user.update({
        where: { id: target.id },
        data: { isActive: false, sessionsValidFrom: new Date() },
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

  // ────────────────────────────────────────────────────────────────────────
  // GH #22 — the session kill-switch.
  //
  // Sessions are stateless JWTs, so there is no session table to delete rows
  // from. Revocation instead stamps a cutoff on the User row; every
  // authenticated request compares the token's `sessionIssuedAt` claim against
  // it (src/server/trpc.ts) and refuses anything older. Effect is immediate on
  // the next request, not at next sign-in.
  //
  // Both mutations are idempotent by design: pressing revoke twice simply moves
  // the cutoff forward. During an incident, "did that actually go through?" is
  // a question people answer by clicking again, and that must be safe.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Offboarding path — cut one user's sessions without touching their account.
   *
   * Separate from `removeMember` because the two are genuinely different
   * actions: "this person's laptop was stolen, sign them out everywhere" must
   * not deactivate an employee who still works here.
   */
  revokeUserSessions: permissionProcedure("sessions.revoke")
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Scoped by organizationId, not just by id: without it an admin could
      // pass any user id in the deployment and sign out another tenant's staff.
      const target = await ctx.prisma.user.findFirst({
        where: { id: input.userId, organizationId },
        select: { id: true, email: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      const revokedAt = new Date();
      await ctx.prisma.user.update({
        where: { id: target.id },
        data: { sessionsValidFrom: revokedAt },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "USER_SESSIONS_REVOKED",
        entity: "User",
        entityId: target.id,
        changes: { email: target.email, revokedAt: revokedAt.toISOString() },
      });

      return { userId: target.id, revokedAt };
    }),

  /**
   * Incident-response path — cut every session in the organization, including
   * the caller's own.
   *
   * THE CALLER IS DELIBERATELY NOT EXEMPTED. The reason to press this is "we
   * think a session was stolen and we cannot tell which one" — an exemption
   * carved out for the presser is exactly the session an attacker who has
   * escalated to admin would be holding. Signing yourself out and back in is a
   * ten-second cost; a kill-switch with a hole in it is not a kill-switch.
   * The UI states this before confirming.
   */
  revokeAllSessions: permissionProcedure("sessions.revoke").mutation(
    async ({ ctx }) => {
      const organizationId = ctx.session.user.organizationId;
      const revokedAt = new Date();

      const { count } = await ctx.prisma.user.updateMany({
        where: { organizationId },
        data: { sessionsValidFrom: revokedAt },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "ORG_SESSIONS_REVOKED",
        entity: "Organization",
        entityId: organizationId,
        changes: { usersAffected: count, revokedAt: revokedAt.toISOString() },
      });

      // The audit event is written BEFORE this returns and while the caller's
      // own session is still resolvable in the 30s identity cache. Ordering
      // matters: an updateMany cannot be attributed to a single id by the cache
      // -invalidation middleware (src/server/db.ts), so entries are cleared by
      // TTL — up to 30 seconds during which some replicas still hold the old
      // row. That window is documented rather than papered over; closing it
      // would mean invalidating every member's key individually, which for a
      // large org is a burst of Redis deletes during an active incident.
      return { usersAffected: count, revokedAt };
    },
  ),

  /**
   * What the Security settings page renders. Returns the org's current session
   * posture so the page can state facts rather than reassurances.
   */
  sessionPosture: orgProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;

    const [mostRecent, self] = await Promise.all([
      ctx.prisma.user.findFirst({
        where: { organizationId, sessionsValidFrom: { not: null } },
        orderBy: { sessionsValidFrom: "desc" },
        select: { sessionsValidFrom: true },
      }),
      ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { sessionsValidFrom: true },
      }),
    ]);

    return {
      maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
      updateAgeSeconds: SESSION_UPDATE_AGE_SECONDS,
      lastRevocationAt: mostRecent?.sessionsValidFrom ?? null,
      ownSessionsValidFrom: self?.sessionsValidFrom ?? null,
    };
  }),
});
