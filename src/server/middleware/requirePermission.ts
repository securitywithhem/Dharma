// Phase 8 Part 1 — tRPC middleware factory for permission-key checks.
//
// requirePermission("controls.write") resolves the caller's effective
// permissions: CustomRole.permissions when the user has a customRoleId,
// otherwise the legacy Role-enum mapping (see rbac/permissions.ts). The
// user row is re-read on every call — permission changes and SCIM
// deactivation take effect immediately, with no session-cached bypass.
//
// WAVE 5.1: the isActive / org-match half of that re-read now lives in
// orgProcedure itself (src/server/trpc.ts), so it applies to every org router
// rather than only the ones using this factory, and the row arrives here
// already resolved on ctx.identity. This middleware keeps its own guard for
// the case where it is composed onto a base that did not populate identity,
// but in the normal path it adds a permission check to an already-fresh row
// rather than re-querying — one cached read per request, not two.
import { TRPCError } from "@trpc/server";
import { t, orgProcedure } from "@/server/trpc";
import { resolveSessionIdentity } from "@/server/lib/sessionIdentity";
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

    const identity =
      (ctx as { identity?: Awaited<ReturnType<typeof resolveSessionIdentity>> })
        .identity ?? (await resolveSessionIdentity(ctx.prisma, sessionUser.id));

    if (!identity || !identity.isActive) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This account is deactivated.",
      });
    }

    if (identity.organizationId !== sessionUser.organizationId) {
      // Stale session pointing at a different org than the DB row — refuse.
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    // Read the CustomRole fresh rather than taking it off the cached identity.
    // SessionIdentity deliberately carries only User-row scalars, because its
    // cache is invalidated on User writes — editing a CustomRole's permission
    // map is not a User write, so a cached copy would stay stale for up to the
    // TTL and break this middleware's documented "permission changes take
    // effect immediately, with no session-cached bypass" guarantee. Costs one
    // indexed lookup, only on the routers that use this factory, and only when
    // the user actually has a custom role assigned.
    const customRole = identity.customRoleId
      ? await ctx.prisma.customRole.findUnique({
          where: { id: identity.customRoleId },
          select: { organizationId: true, permissions: true },
        })
      : null;

    const user = {
      role: identity.role,
      organizationId: identity.organizationId,
      customRole,
    };

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
