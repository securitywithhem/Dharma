// Phase 8 Part 1 — SCIM 2.0 core: resource mapping, filter parsing, and the
// user/group operations shared by the route handlers.
//
// Compatibility targets (TRD: "server implementation for Azure/Okta
// provisioning") — both clients' quirks are handled explicitly:
// - Okta sends lowercase PATCH ops ("replace"), filters `userName eq "..."`.
// - Azure AD capitalizes ops ("Replace"), sometimes sends booleans as the
//   strings "True"/"False", and PATCHes without a path using a value object.
//
// Deactivation is a soft-delete (User.isActive = false) — SCIM DELETE never
// removes rows, preserving audit-chain integrity.
import type { PrismaClient, User, CustomRole } from "@prisma/client";
import { Role } from "@prisma/client";
import { emitAuditEvent } from "@/server/services/audit/writer";

export class ScimRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly scimType?: string,
  ) {
    super(message);
  }
}

// AuditLog.userId must reference a real user, so the system actor is
// recorded in `changes.actor` with userId null (no human session exists).
export const SCIM_ACTOR = "scim-provisioning";

async function scimAudit(
  prisma: PrismaClient,
  organizationId: string,
  action: string,
  entity: string,
  entityId: string,
  changes: Record<string, unknown>,
) {
  await emitAuditEvent(prisma, {
    organizationId,
    userId: null,
    action,
    entity,
    entityId,
    changes: { actor: SCIM_ACTOR, ...changes },
  });
}

// ---------------------------------------------------------------------------
// Resource serialization
// ---------------------------------------------------------------------------

export function toScimUser(user: User, baseUrl: string) {
  const [givenName, ...rest] = (user.name ?? "").split(" ");
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.scimExternalId ?? undefined,
    userName: user.email,
    name: {
      formatted: user.name ?? user.email,
      givenName: givenName || undefined,
      familyName: rest.join(" ") || undefined,
    },
    displayName: user.name ?? user.email,
    emails: [{ value: user.email, primary: true, type: "work" }],
    active: user.isActive,
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${user.id}`,
    },
  };
}

export function toScimGroup(
  role: CustomRole & { users: Pick<User, "id" | "email">[] },
  baseUrl: string,
) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: role.id,
    displayName: role.name,
    members: role.users.map((u) => ({
      value: u.id,
      display: u.email,
      $ref: `${baseUrl}/Users/${u.id}`,
    })),
    meta: {
      resourceType: "Group",
      created: role.createdAt.toISOString(),
      lastModified: role.updatedAt.toISOString(),
      location: `${baseUrl}/Groups/${role.id}`,
    },
  };
}

export function listResponse(resources: unknown[], startIndex: number, totalResults: number) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

// ---------------------------------------------------------------------------
// Filter / payload parsing
// ---------------------------------------------------------------------------

/** Parses the single-clause `attr eq "value"` filters Okta/Azure send. */
export function parseEqFilter(filter: string | null): { attribute: string; value: string } | null {
  if (!filter) return null;
  const match = filter.match(/^\s*(\w+)\s+eq\s+"([^"]*)"\s*$/i);
  if (!match) {
    throw new ScimRequestError(400, `Unsupported filter: ${filter}`, "invalidFilter");
  }
  return { attribute: match[1].toLowerCase(), value: match[2] };
}

/** Azure AD sends booleans as "True"/"False" strings in PATCH values. */
export function coerceScimBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

type ScimUserPayload = {
  userName?: string;
  externalId?: string;
  displayName?: string;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  active?: unknown;
};

function displayNameFrom(payload: ScimUserPayload): string | null {
  if (payload.displayName) return payload.displayName;
  if (payload.name?.formatted) return payload.name.formatted;
  const joined = [payload.name?.givenName, payload.name?.familyName]
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

export async function listScimUsers(
  prisma: PrismaClient,
  organizationId: string,
  options: { filter: string | null; startIndex: number; count: number },
  baseUrl: string,
) {
  const parsed = parseEqFilter(options.filter);
  const where: Record<string, unknown> = { organizationId };
  if (parsed) {
    if (parsed.attribute === "username") {
      where.email = parsed.value.toLowerCase();
    } else if (parsed.attribute === "externalid") {
      where.scimExternalId = parsed.value;
    } else if (parsed.attribute === "id") {
      where.id = parsed.value;
    } else {
      throw new ScimRequestError(
        400,
        `Filtering on "${parsed.attribute}" is not supported.`,
        "invalidFilter",
      );
    }
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where: where as never }),
    prisma.user.findMany({
      where: where as never,
      orderBy: { createdAt: "asc" },
      skip: Math.max(0, options.startIndex - 1),
      take: Math.min(options.count, 200),
    }),
  ]);

  return listResponse(
    users.map((u) => toScimUser(u, baseUrl)),
    options.startIndex,
    total,
  );
}

export async function createScimUser(
  prisma: PrismaClient,
  organizationId: string,
  payload: ScimUserPayload,
  baseUrl: string,
) {
  const email = payload.userName?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new ScimRequestError(400, "userName must be an email address.", "invalidValue");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // 409 regardless of which org holds the email — never confirm to org A's
    // IdP that the address exists in some other tenant.
    throw new ScimRequestError(
      409,
      `A user with userName ${email} already exists.`,
      "uniqueness",
    );
  }

  const active = coerceScimBoolean(payload.active) ?? true;
  const user = await prisma.user.create({
    data: {
      email,
      name: displayNameFrom(payload),
      organizationId,
      role: Role.VIEWER,
      isActive: active,
      scimExternalId: payload.externalId ?? null,
      emailVerified: new Date(),
    },
  });

  await scimAudit(prisma, organizationId, "SCIM_USER_CREATED", "User", user.id, {
    email,
    externalId: payload.externalId ?? null,
    active,
  });

  return toScimUser(user, baseUrl);
}

export async function getScimUser(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  baseUrl: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
  if (!user) throw new ScimRequestError(404, `User ${userId} not found.`);
  return toScimUser(user, baseUrl);
}

export async function replaceScimUser(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  payload: ScimUserPayload,
  baseUrl: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
  if (!user) throw new ScimRequestError(404, `User ${userId} not found.`);

  const active = coerceScimBoolean(payload.active);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name: displayNameFrom(payload) ?? user.name,
      scimExternalId: payload.externalId ?? user.scimExternalId,
      ...(active === undefined ? {} : { isActive: active }),
      // userName/email changes are intentionally not honored: email is the
      // cross-provider identity anchor (NextAuth + SSO JIT match on it).
    },
  });

  await scimAudit(prisma, organizationId, "SCIM_USER_UPDATED", "User", user.id, {
    replaced: true,
    active: updated.isActive,
  });

  return toScimUser(updated, baseUrl);
}

type ScimPatchOperation = {
  op: string;
  path?: string;
  value?: unknown;
};

export async function patchScimUser(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
  operations: ScimPatchOperation[],
  baseUrl: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
  if (!user) throw new ScimRequestError(404, `User ${userId} not found.`);

  const data: { isActive?: boolean; name?: string; scimExternalId?: string } = {};
  const applied: Record<string, unknown> = {};

  for (const operation of operations) {
    const op = operation.op?.toLowerCase();
    if (op !== "replace" && op !== "add") {
      // "remove" on core attributes isn't meaningful for our mapping.
      continue;
    }
    const path = operation.path?.toLowerCase();

    if (!path && typeof operation.value === "object" && operation.value !== null) {
      // Azure-style: no path, value is a partial resource object.
      const value = operation.value as ScimUserPayload;
      const active = coerceScimBoolean(value.active);
      if (active !== undefined) {
        data.isActive = active;
        applied.active = active;
      }
      const name = displayNameFrom(value);
      if (name) {
        data.name = name;
        applied.name = name;
      }
      if (value.externalId) {
        data.scimExternalId = value.externalId;
        applied.externalId = value.externalId;
      }
      continue;
    }

    if (path === "active") {
      const active = coerceScimBoolean(operation.value);
      if (active !== undefined) {
        data.isActive = active;
        applied.active = active;
      }
    } else if (path === "displayname" || path === "name.formatted") {
      if (typeof operation.value === "string") {
        data.name = operation.value;
        applied.name = operation.value;
      }
    } else if (path === "externalid") {
      if (typeof operation.value === "string") {
        data.scimExternalId = operation.value;
        applied.externalId = operation.value;
      }
    }
    // Unknown paths are ignored rather than rejected — Okta/Azure PATCH
    // attributes we don't map (e.g. phoneNumbers) and expect 200.
  }

  const updated =
    Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id: user.id }, data })
      : user;

  if (Object.keys(applied).length > 0) {
    const action =
      applied.active === false ? "SCIM_USER_DEACTIVATED" : "SCIM_USER_UPDATED";
    await scimAudit(prisma, organizationId, action, "User", user.id, applied);
  }

  return toScimUser(updated, baseUrl);
}

/** SCIM DELETE — soft-deactivate only (audit integrity; never hard-delete). */
export async function deactivateScimUser(
  prisma: PrismaClient,
  organizationId: string,
  userId: string,
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
  });
  if (!user) throw new ScimRequestError(404, `User ${userId} not found.`);

  // GH #22 — stamp the session cutoff alongside the soft-delete, matching
  // organization.removeMember. `isActive: false` is already refused by
  // orgProcedure, so this is not what stops them; it is what leaves a
  // *timestamp* on the row recording when their sessions were cut. IdP-driven
  // deprovisioning is the offboarding path enterprise buyers actually audit,
  // and "show me when access was revoked" needs an answer that is not inferred
  // from an audit-log row that may fall outside the retention window.
  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false, sessionsValidFrom: new Date() },
  });

  await scimAudit(prisma, organizationId, "SCIM_USER_DEACTIVATED", "User", user.id, {
    softDelete: true,
  });
}

// ---------------------------------------------------------------------------
// Group operations — SCIM Groups map to CustomRole (IdP group assignment
// drives role membership; permissions themselves stay admin-managed).
// ---------------------------------------------------------------------------

export async function listScimGroups(
  prisma: PrismaClient,
  organizationId: string,
  options: { filter: string | null; startIndex: number; count: number },
  baseUrl: string,
) {
  const parsed = parseEqFilter(options.filter);
  const where: Record<string, unknown> = { organizationId };
  if (parsed) {
    if (parsed.attribute === "displayname") {
      where.name = parsed.value;
    } else if (parsed.attribute === "id") {
      where.id = parsed.value;
    } else {
      throw new ScimRequestError(
        400,
        `Filtering groups on "${parsed.attribute}" is not supported.`,
        "invalidFilter",
      );
    }
  }

  const [total, roles] = await Promise.all([
    prisma.customRole.count({ where: where as never }),
    prisma.customRole.findMany({
      where: where as never,
      orderBy: { createdAt: "asc" },
      skip: Math.max(0, options.startIndex - 1),
      take: Math.min(options.count, 200),
      include: { users: { select: { id: true, email: true } } },
    }),
  ]);

  return listResponse(
    roles.map((r) => toScimGroup(r, baseUrl)),
    options.startIndex,
    total,
  );
}

export async function createScimGroup(
  prisma: PrismaClient,
  organizationId: string,
  payload: { displayName?: string; members?: Array<{ value?: string }> },
  baseUrl: string,
) {
  const name = payload.displayName?.trim();
  if (!name) {
    throw new ScimRequestError(400, "displayName is required.", "invalidValue");
  }

  const existing = await prisma.customRole.findUnique({
    where: { organizationId_name: { organizationId, name } },
  });
  if (existing) {
    throw new ScimRequestError(409, `Group "${name}" already exists.`, "uniqueness");
  }

  // IdP-provisioned roles start with no permissions — an org admin grants
  // them in the roles UI. Provisioning must never silently grant access.
  const role = await prisma.customRole.create({
    data: { organizationId, name, permissions: {} },
  });

  const memberIds = (payload.members ?? [])
    .map((m) => m.value)
    .filter((v): v is string => typeof v === "string");
  if (memberIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: memberIds }, organizationId },
      data: { customRoleId: role.id },
    });
  }

  await scimAudit(prisma, organizationId, "SCIM_GROUP_CREATED", "CustomRole", role.id, {
    name,
    members: memberIds,
  });

  const withUsers = await prisma.customRole.findUniqueOrThrow({
    where: { id: role.id },
    include: { users: { select: { id: true, email: true } } },
  });
  return toScimGroup(withUsers, baseUrl);
}

export async function getScimGroup(
  prisma: PrismaClient,
  organizationId: string,
  groupId: string,
  baseUrl: string,
) {
  const role = await prisma.customRole.findFirst({
    where: { id: groupId, organizationId },
    include: { users: { select: { id: true, email: true } } },
  });
  if (!role) throw new ScimRequestError(404, `Group ${groupId} not found.`);
  return toScimGroup(role, baseUrl);
}

export async function patchScimGroup(
  prisma: PrismaClient,
  organizationId: string,
  groupId: string,
  operations: ScimPatchOperation[],
  baseUrl: string,
) {
  const role = await prisma.customRole.findFirst({
    where: { id: groupId, organizationId },
  });
  if (!role) throw new ScimRequestError(404, `Group ${groupId} not found.`);

  for (const operation of operations) {
    const op = operation.op?.toLowerCase();
    const path = operation.path?.toLowerCase() ?? "";

    if ((op === "add" || op === "replace") && path === "members") {
      const members = Array.isArray(operation.value) ? operation.value : [];
      const memberIds = members
        .map((m: { value?: string }) => m?.value)
        .filter((v: unknown): v is string => typeof v === "string");
      if (op === "replace") {
        await prisma.user.updateMany({
          where: { customRoleId: role.id, organizationId },
          data: { customRoleId: null },
        });
      }
      if (memberIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: memberIds }, organizationId },
          data: { customRoleId: role.id },
        });
      }
      await scimAudit(
        prisma,
        organizationId,
        "SCIM_GROUP_MEMBERS_CHANGED",
        "CustomRole",
        role.id,
        { op, members: memberIds },
      );
    } else if (op === "remove" && path.startsWith("members")) {
      // Okta: path = members[value eq "<id>"]; Azure may pass value list.
      const idFromPath = operation.path?.match(/value\s+eq\s+"([^"]+)"/i)?.[1];
      const memberIds = idFromPath
        ? [idFromPath]
        : (Array.isArray(operation.value) ? operation.value : [])
            .map((m: { value?: string }) => m?.value)
            .filter((v: unknown): v is string => typeof v === "string");
      if (memberIds.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: memberIds }, organizationId, customRoleId: role.id },
          data: { customRoleId: null },
        });
        await scimAudit(
          prisma,
          organizationId,
          "SCIM_GROUP_MEMBERS_CHANGED",
          "CustomRole",
          role.id,
          { op: "remove", members: memberIds },
        );
      }
    } else if (op === "replace" && (path === "" || path === "displayname")) {
      const newName =
        typeof operation.value === "string"
          ? operation.value
          : (operation.value as { displayName?: string } | undefined)?.displayName;
      if (newName && newName !== role.name) {
        if (role.isDefault) {
          throw new ScimRequestError(403, "Built-in roles cannot be renamed via SCIM.");
        }
        await prisma.customRole.update({
          where: { id: role.id },
          data: { name: newName },
        });
        await scimAudit(prisma, organizationId, "SCIM_GROUP_RENAMED", "CustomRole", role.id, {
          from: role.name,
          to: newName,
        });
      }
    }
  }

  return getScimGroup(prisma, organizationId, groupId, baseUrl);
}

export async function deleteScimGroup(
  prisma: PrismaClient,
  organizationId: string,
  groupId: string,
) {
  const role = await prisma.customRole.findFirst({
    where: { id: groupId, organizationId },
  });
  if (!role) throw new ScimRequestError(404, `Group ${groupId} not found.`);
  if (role.isDefault) {
    throw new ScimRequestError(403, "Built-in roles cannot be deleted via SCIM.");
  }

  // Members fall back to their legacy enum role (customRoleId → null via
  // the relation's onDelete: SetNull).
  await prisma.customRole.delete({ where: { id: role.id } });

  await scimAudit(prisma, organizationId, "SCIM_GROUP_DELETED", "CustomRole", role.id, {
    name: role.name,
  });
}
