// Phase 8 Part 1 — canonical RBAC permission-key registry.
//
// Every permission check in the app resolves to one of these keys. Custom
// roles (CustomRole.permissions) store a { key: boolean } map validated
// against this registry; users without a customRoleId fall back to the
// legacy Role enum mapping below, so pre-Phase-8 members keep working
// unchanged (Implementationplan.md task 3: "extend MemberRole to
// permissions JSON" — the repo's enum is `Role`, not `MemberRole`).
import { Role } from "@prisma/client";

export const PERMISSION_KEYS = [
  "controls.read",
  "controls.write",
  "evidence.read",
  "evidence.upload",
  "policies.read",
  "policies.write",
  "billing.manage",
  "connectors.manage",
  "pentest.request",
  "vulns.manage",
  "members.invite",
  "roles.manage",
  // GH #22 — pressing the session kill-switch (org-wide or per-user).
  // Deliberately its own key rather than reusing `members.invite`: revoking
  // every session in the org is an incident-response action that signs out the
  // whole company, and an org that has delegated "can invite teammates" to an
  // office manager has not thereby delegated that.
  "sessions.revoke",
  "marketplace.publish",
  "reports.generate",
  "sso.configure",
  "scim.manage",
  "audit.read",
  "audit.export",
  "whitelabel.manage",
  // Phase 8 Part 3 — cross-org MSSP aggregate views (grant-gated on top of
  // this permission; see src/server/services/mssp/aggregateQuery.service.ts).
  "mssp.viewAllClients",
  // Creating/revoking MsspGrants — parent-org admins only.
  "mssp.manageGrants",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

export function isPermissionKey(key: string): key is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(key);
}

function grant(keys: PermissionKey[]): PermissionMap {
  return Object.fromEntries(keys.map((k) => [k, true]));
}

// NOTE: audit.read is deliberately NOT part of the shared read-only set —
// the pre-Phase-8 audit viewer was admin-only (adminProcedure), and widening
// it silently would be a regression. Custom roles can grant it explicitly.
const READ_ONLY: PermissionKey[] = [
  "controls.read",
  "evidence.read",
  "policies.read",
];

// Legacy Role enum → default permission sets. ADMIN gets everything;
// COMPLIANCE_MANAGER mirrors the existing hasManagementAccess() surface
// (compliance work, no org administration); PUBLISHER is the marketplace
// author role; VIEWER is read-only.
export const LEGACY_ROLE_PERMISSIONS: Record<Role, PermissionMap> = {
  [Role.ADMIN]: grant([...PERMISSION_KEYS]),
  [Role.COMPLIANCE_MANAGER]: grant([
    ...READ_ONLY,
    "controls.write",
    "evidence.upload",
    "policies.write",
    "connectors.manage",
    "pentest.request",
    "vulns.manage",
    // NOTE: reports.generate is deliberately NOT in the manager set — same
    // reasoning as audit.read above. Report generation has always been
    // adminProcedure-gated (routers/report.ts). WAVE 9.1 made this key actually
    // enforce, and granting it to every COMPLIANCE_MANAGER in the same change
    // would have silently widened access to reports as a side effect of a
    // security fix. A custom role can still grant it explicitly.
  ]),
  [Role.PUBLISHER]: grant([...READ_ONLY, "marketplace.publish"]),
  [Role.VIEWER]: grant(READ_ONLY),
};

export function legacyRoleHasPermission(
  role: Role,
  permission: PermissionKey,
): boolean {
  return LEGACY_ROLE_PERMISSIONS[role]?.[permission] === true;
}

/**
 * Resolves a permission for a user record. `customRole` (when assigned and
 * belonging to the user's own org) wins over the legacy enum; a custom role
 * is authoritative for every key — an absent key means "denied", not
 * "fall through to the enum" — so a restrictive custom role can never be
 * widened by the member's old enum value.
 */
export function resolvePermission(
  user: {
    role: Role;
    organizationId: string;
    customRole: { organizationId: string; permissions: unknown } | null;
  },
  permission: PermissionKey,
): boolean {
  if (user.customRole) {
    if (user.customRole.organizationId !== user.organizationId) {
      // Cross-org role assignment should be impossible (roles.assignToMember
      // validates it) — treat as denied rather than falling back.
      return false;
    }
    const permissions = user.customRole.permissions as PermissionMap | null;
    return permissions?.[permission] === true;
  }

  return legacyRoleHasPermission(user.role, permission);
}
