import { Role } from "@prisma/client";

const managementRoles = new Set<Role>([Role.ADMIN, Role.COMPLIANCE_MANAGER]);

export function hasManagementAccess(role: Role | undefined | null) {
  return role ? managementRoles.has(role) : false;
}

export function isAdminRole(role: Role | undefined | null) {
  return role === Role.ADMIN;
}
