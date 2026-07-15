// Phase 8 Part 1 — shared JIT user provisioning for SAML and OIDC logins.
import type { PrismaClient, User } from "@prisma/client";
import { Role } from "@prisma/client";
import { emitAuditEvent } from "@/server/services/audit/writer";

export class SsoProvisioningError extends Error {
  constructor(
    message: string,
    /** Safe to surface to the browser (no assertion/claim contents). */
    public readonly publicMessage: string,
  ) {
    super(message);
    this.name = "SsoProvisioningError";
  }
}

type UpsertInput = {
  prisma: PrismaClient;
  organizationId: string;
  email: string;
  name?: string | null;
  provider: "saml" | "oidc";
  ipAddress?: string | null;
};

/**
 * Finds or JIT-creates the user for a validated SSO assertion and writes the
 * SSO_LOGIN audit entry.
 *
 * Tenant-safety invariant: an email that already belongs to a user in a
 * DIFFERENT organization is rejected outright — org A's IdP must never be
 * able to mint a session for org B's user. JIT-created users get the
 * least-privileged VIEWER role; admins promote them afterwards (or SCIM
 * group sync assigns a custom role).
 */
export async function upsertSsoUser(input: UpsertInput): Promise<User> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) {
    throw new SsoProvisioningError(
      `SSO assertion for org ${input.organizationId} carried no usable email`,
      "Your identity provider did not supply a valid email address.",
    );
  }

  const existing = await input.prisma.user.findUnique({ where: { email } });

  let user: User;
  if (existing) {
    if (existing.organizationId !== input.organizationId) {
      throw new SsoProvisioningError(
        `SSO login for org ${input.organizationId} matched user ${existing.id} of org ${existing.organizationId}`,
        "This email address belongs to a different workspace.",
      );
    }
    if (!existing.isActive) {
      throw new SsoProvisioningError(
        `SSO login attempt for deactivated user ${existing.id}`,
        "This account has been deactivated.",
      );
    }
    user =
      input.name && input.name !== existing.name
        ? await input.prisma.user.update({
            where: { id: existing.id },
            data: { name: input.name },
          })
        : existing;
  } else {
    user = await input.prisma.user.create({
      data: {
        email,
        name: input.name ?? null,
        organizationId: input.organizationId,
        role: Role.VIEWER,
        emailVerified: new Date(),
      },
    });
  }

  await emitAuditEvent(input.prisma, {
    organizationId: input.organizationId,
    userId: user.id,
    action: "SSO_LOGIN",
    entity: "User",
    entityId: user.id,
    changes: {
      provider: input.provider,
      jitProvisioned: !existing,
      ipAddress: input.ipAddress ?? null,
    },
  });

  return user;
}
