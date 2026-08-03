// Phase 8 Part 1 — custom-role management (RBAC with custom roles).
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";
import {
  PERMISSION_KEYS,
  LEGACY_ROLE_PERMISSIONS,
  isPermissionKey,
  type PermissionMap,
} from "@/server/services/rbac/permissions";

const permissionsInput = z.record(z.string(), z.boolean()).superRefine(
  (value, ctx) => {
    for (const key of Object.keys(value)) {
      if (!isPermissionKey(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown permission key: ${key}`,
        });
      }
    }
  },
);

// Built-in roles mirroring the legacy enum, seeded once per org so the roles
// UI always has a baseline to show/assign. Protected from edit/delete.
const DEFAULT_ROLE_SEEDS = [
  { name: "Admin", legacyRole: "ADMIN" as const },
  { name: "Compliance Manager", legacyRole: "COMPLIANCE_MANAGER" as const },
  { name: "Publisher", legacyRole: "PUBLISHER" as const },
  { name: "Viewer", legacyRole: "VIEWER" as const },
];

async function ensureDefaultRoles(prisma: PrismaClient, organizationId: string) {
  const existingDefaults = await prisma.customRole.count({
    where: { organizationId, isDefault: true },
  });
  if (existingDefaults >= DEFAULT_ROLE_SEEDS.length) return;

  for (const seed of DEFAULT_ROLE_SEEDS) {
    await prisma.customRole.upsert({
      where: { organizationId_name: { organizationId, name: seed.name } },
      create: {
        organizationId,
        name: seed.name,
        permissions: LEGACY_ROLE_PERMISSIONS[seed.legacyRole] as object,
        isDefault: true,
      },
      update: {},
    });
  }
}

export const rolesRouter = createTRPCRouter({
  /** The canonical permission-key registry, for the role-editor UI matrix. */
  permissionKeys: permissionProcedure("roles.manage").query(() => [
    ...PERMISSION_KEYS,
  ]),

  list: permissionProcedure("roles.manage").query(async ({ ctx }) => {
    const organizationId = ctx.session.user.organizationId;
    await ensureDefaultRoles(ctx.prisma, organizationId);
    const roles = await ctx.prisma.customRole.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      include: { _count: { select: { users: true } } },
    });

    // MEMBER COUNT — why this is not just `_count.users`.
    //
    // `_count.users` counts only EXPLICIT assignments (User.customRoleId). A
    // user who has never been re-assigned keeps customRoleId = null and draws
    // their permissions from the legacy `role` enum instead — that fallback is
    // deliberate (see the comment on User.customRoleId in schema.prisma), and
    // the built-in roles exist precisely to mirror those enum values. So on a
    // normally-seeded org every member sat on the legacy path and every role
    // reported 0 members, while Settings → Team listed them correctly.
    //
    // The effective membership of a built-in role is therefore: explicit
    // assignments + members still on the matching legacy enum. We resolve it
    // at read time rather than backfilling customRoleId, because a backfill
    // would snapshot today's permissions onto every user and silently detach
    // them from LEGACY_ROLE_PERMISSIONS — changing authorization behaviour to
    // fix a display bug. The legacy enum stays canonical until a user is
    // explicitly assigned a role; that is the rule the permission middleware
    // already enforces.
    const legacyCounts = await ctx.prisma.user.groupBy({
      by: ["role"],
      where: { organizationId, customRoleId: null, isActive: true },
      _count: { _all: true },
    });
    const legacyByRole = new Map(legacyCounts.map((r) => [r.role as string, r._count._all]));
    const legacyRoleForName = new Map(DEFAULT_ROLE_SEEDS.map((s) => [s.name, s.legacyRole as string]));

    return roles.map((role) => {
      const legacyRole = role.isDefault ? legacyRoleForName.get(role.name) : undefined;
      const legacyMembers = legacyRole ? (legacyByRole.get(legacyRole) ?? 0) : 0;
      return { ...role, memberCount: role._count.users + legacyMembers };
    });
  }),

  create: permissionProcedure("roles.manage")
    .input(
      z.object({
        name: z.string().trim().min(2).max(64),
        permissions: permissionsInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const role = await ctx.prisma.customRole
        .create({
          data: {
            organizationId,
            name: input.name,
            permissions: input.permissions as PermissionMap as object,
          },
        })
        .catch(() => {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A role named "${input.name}" already exists.`,
          });
        });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "ROLE_CREATED",
        entity: "CustomRole",
        entityId: role.id,
        changes: { name: input.name, permissions: input.permissions },
      });

      return role;
    }),

  update: permissionProcedure("roles.manage")
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(2).max(64).optional(),
        permissions: permissionsInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const role = await ctx.prisma.customRole.findFirst({
        where: { id: input.id, organizationId },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role.isDefault) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in roles cannot be modified — create a custom role instead.",
        });
      }

      const updated = await ctx.prisma.customRole.update({
        where: { id: role.id },
        data: {
          name: input.name,
          permissions: input.permissions as object | undefined,
        },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "ROLE_UPDATED",
        entity: "CustomRole",
        entityId: role.id,
        changes: { name: input.name ?? role.name, permissions: input.permissions ?? null },
      });

      return updated;
    }),

  delete: permissionProcedure("roles.manage")
    .input(
      z.object({
        id: z.string(),
        /** Required when members still hold the role — they're moved here. */
        reassignToRoleId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;
      const role = await ctx.prisma.customRole.findFirst({
        where: { id: input.id, organizationId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      if (role.isDefault) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in roles cannot be deleted.",
        });
      }

      if (role._count.users > 0) {
        if (!input.reassignToRoleId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${role._count.users} member(s) still hold this role — pick a role to reassign them to.`,
          });
        }
        const target = await ctx.prisma.customRole.findFirst({
          where: { id: input.reassignToRoleId, organizationId },
        });
        if (!target || target.id === role.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Reassignment target role not found in this organization.",
          });
        }
        await ctx.prisma.user.updateMany({
          where: { customRoleId: role.id, organizationId },
          data: { customRoleId: target.id },
        });
      }

      await ctx.prisma.customRole.delete({ where: { id: role.id } });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "ROLE_DELETED",
        entity: "CustomRole",
        entityId: role.id,
        changes: {
          name: role.name,
          reassignedTo: input.reassignToRoleId ?? null,
          affectedMembers: role._count.users,
        },
      });

      return { deleted: true };
    }),

  assignToMember: permissionProcedure("roles.manage")
    .input(
      z.object({
        userId: z.string(),
        /** null clears the custom role → member falls back to the legacy enum. */
        customRoleId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const member = await ctx.prisma.user.findFirst({
        where: { id: input.userId, organizationId },
      });
      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found in this organization.",
        });
      }

      if (input.customRoleId) {
        const role = await ctx.prisma.customRole.findFirst({
          where: { id: input.customRoleId, organizationId },
        });
        if (!role) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Role not found in this organization.",
          });
        }
      }

      const updated = await ctx.prisma.user.update({
        where: { id: member.id },
        data: { customRoleId: input.customRoleId },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "ROLE_ASSIGNED",
        entity: "User",
        entityId: member.id,
        changes: {
          customRoleId: input.customRoleId,
          previousCustomRoleId: member.customRoleId,
        },
      });

      return { userId: updated.id, customRoleId: updated.customRoleId };
    }),
});
