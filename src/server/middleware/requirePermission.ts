// Phase 8 Part 1 — tRPC middleware factory for permission-key checks.
//
// requirePermission("controls.write") resolves the caller's effective
// permissions: CustomRole.permissions when the user has a customRoleId,
// otherwise the legacy Role-enum mapping (see rbac/permissions.ts). The
// user row is re-read on every call — permission changes and SCIM
// deactivation take effect immediately, with no session-cached bypass.
//
// Retrofit status: applied to all Phase 8 routers (sso, roles, audit,
// whiteLabel, mssp). Pre-Phase-8 routers still use managerProcedure /
// adminProcedure and are a follow-up migration, noted in the Phase 8 report.
import { TRPCError } from "@trpc/server";
import { t, orgProcedure } from "@/server/trpc";
import {
  resolvePermission,
  type PermissionKey,
} from "@/server/services/rbac/permissions";

export function requirePermission(permission: PermissionKey) {
  return t.middleware(async ({ ctx, next }) => {
    const sessionUser = ctx.session?.user;
    if (!sessionUser?.id || !sessionUser.organizationId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const user = await ctx.prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        role: true,
        organizationId: true,
        isActive: true,
        customRole: {
          select: { organizationId: true, permissions: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This account is deactivated.",
      });
    }

    if (user.organizationId !== sessionUser.organizationId) {
      // Stale session pointing at a different org than the DB row — refuse.
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    if (!resolvePermission(user, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing required permission: ${permission}`,
      });
    }

    return next();
  });
}

/** orgProcedure + a permission check — the standard Phase 8 procedure base. */
export function permissionProcedure(permission: PermissionKey) {
  return orgProcedure.use(requirePermission(permission));
}
