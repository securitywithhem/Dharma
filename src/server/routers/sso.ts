// Phase 8 Part 1 — SSO / SCIM configuration router.
// All procedures go through requirePermission (Part 1's RBAC middleware);
// every mutation emits a hash-chained AuditLog entry via the Part 2 canonical
// writer, emitAuditEvent (repo convention: SCREAMING_SNAKE actions).
import { createHmac, randomBytes, createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter } from "@/server/trpc";
import { permissionProcedure } from "@/server/middleware/requirePermission";
import { emitAuditEvent } from "@/server/services/audit/writer";
import { env } from "@/env";
import { encryptSsoSecret } from "@/server/lib/crypto/ssoVault";
import {
  validateMetadata,
  samlCallbackUrl,
  samlSpEntityId,
  SamlConfigError,
} from "@/server/services/sso/saml.service";
import {
  testOidcDiscovery,
  oidcCallbackUrl,
  OidcConfigError,
} from "@/server/services/sso/oidc.service";
import { parseStoredSsoConfig } from "@/server/services/sso/types";

// ---- enforceSsoOnly confirmation-token pattern -----------------------------
// Enforcing SSO-only login can lock every non-SSO user out of the org, so it
// is a two-step mutation: the first call returns a short-lived HMAC token the
// client must echo back. Tokens are bound to org + admin + desired state and
// valid for the current or previous 5-minute window.
const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

function enforcementToken(
  orgId: string,
  userId: string,
  enabled: boolean,
  window: number,
) {
  return createHmac("sha256", env.NEXTAUTH_SECRET)
    .update(`enforce-sso:${orgId}:${userId}:${enabled}:${window}`)
    .digest("hex")
    .slice(0, 32);
}

function isValidEnforcementToken(
  token: string,
  orgId: string,
  userId: string,
  enabled: boolean,
) {
  const currentWindow = Math.floor(Date.now() / CONFIRM_WINDOW_MS);
  return (
    token === enforcementToken(orgId, userId, enabled, currentWindow) ||
    token === enforcementToken(orgId, userId, enabled, currentWindow - 1)
  );
}

function redactSsoConfig(config: ReturnType<typeof parseStoredSsoConfig>) {
  if (!config) return null;
  if (config.type === "OIDC") {
    const { clientSecretEnc: _redacted, ...rest } = config;
    return { ...rest, clientSecretSet: true };
  }
  // SAML config holds only public IdP values (cert is the public signing
  // cert), but truncate it anyway to keep responses small.
  return { ...config, certificate: `${config.certificate.slice(0, 24)}…` };
}

export const ssoRouter = createTRPCRouter({
  getConfig: permissionProcedure("sso.configure").query(async ({ ctx }) => {
    const orgId = ctx.session.user.organizationId;
    const settings = await ctx.prisma.organizationSettings.findUnique({
      where: { organizationId: orgId },
    });
    return {
      ssoConfig: redactSsoConfig(parseStoredSsoConfig(settings?.ssoConfig)),
      ssoEnforced: settings?.ssoEnforced ?? false,
      scimEnabled: settings?.scimEnabled ?? false,
      scimTokenSet: Boolean(settings?.scimTokenHash),
      urls: {
        samlLogin: `${env.NEXTAUTH_URL}/api/sso/saml/${orgId}/login`,
        samlAcs: samlCallbackUrl(orgId),
        samlSpEntityId: samlSpEntityId(orgId),
        samlSpMetadata: samlSpEntityId(orgId),
        oidcLogin: `${env.NEXTAUTH_URL}/api/sso/oidc/${orgId}/login`,
        oidcRedirect: oidcCallbackUrl(orgId),
        scimBase: `${env.NEXTAUTH_URL}/api/scim/v2/${orgId}`,
      },
    };
  }),

  configureSaml: permissionProcedure("sso.configure")
    .input(z.object({ metadataXmlOrUrl: z.string().min(1).max(512_000) }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.user.organizationId;
      let config;
      try {
        config = await validateMetadata(input.metadataXmlOrUrl);
      } catch (error) {
        if (error instanceof SamlConfigError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ssoConfig: config },
        update: { ssoConfig: config },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: orgId,
        userId: ctx.session.user.id,
        action: "SSO_CONFIG_UPDATED",
        entity: "OrganizationSettings",
        entityId: orgId,
        changes: { type: "SAML", entityId: config.entityId, ssoUrl: config.ssoUrl },
      });

      return {
        acsUrl: samlCallbackUrl(orgId),
        spEntityId: samlSpEntityId(orgId),
        idpEntityId: config.entityId,
      };
    }),

  configureOidc: permissionProcedure("sso.configure")
    .input(
      z.object({
        issuer: z.string().url(),
        clientId: z.string().min(1).max(512),
        clientSecret: z.string().min(1).max(4096),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.user.organizationId;
      try {
        await testOidcDiscovery(input.issuer);
      } catch (error) {
        if (error instanceof OidcConfigError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      const config = {
        type: "OIDC" as const,
        issuer: input.issuer,
        clientId: input.clientId,
        clientSecretEnc: encryptSsoSecret(input.clientSecret),
      };

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ssoConfig: config },
        update: { ssoConfig: config },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: orgId,
        userId: ctx.session.user.id,
        action: "SSO_CONFIG_UPDATED",
        entity: "OrganizationSettings",
        entityId: orgId,
        // Never the secret — only which fields changed.
        changes: { type: "OIDC", issuer: input.issuer, clientId: input.clientId },
      });

      return { redirectUri: oidcCallbackUrl(orgId) };
    }),

  /** Dry-run validation of the saved config (App Flow step 3). */
  testConnection: permissionProcedure("sso.configure").mutation(
    async ({ ctx }) => {
      const orgId = ctx.session.user.organizationId;
      const settings = await ctx.prisma.organizationSettings.findUnique({
        where: { organizationId: orgId },
      });
      const config = parseStoredSsoConfig(settings?.ssoConfig);
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No SSO configuration saved yet.",
        });
      }

      if (config.type === "SAML") {
        if (config.metadataUrl) {
          // Re-fetch + re-parse proves the IdP is still reachable and sane.
          await validateMetadata(config.metadataUrl);
        }
        return {
          ok: true as const,
          type: config.type,
          callbackUrl: samlCallbackUrl(orgId),
          spEntityId: samlSpEntityId(orgId),
        };
      }

      const discovered = await testOidcDiscovery(config.issuer);
      return {
        ok: true as const,
        type: config.type,
        callbackUrl: oidcCallbackUrl(orgId),
        issuer: discovered.issuer,
      };
    },
  ),

  /**
   * Toggles SSO-only login enforcement (App Flow step 4). High-severity:
   * requires the two-step confirmation token, and is always audit-logged.
   */
  enforceSsoOnly: permissionProcedure("sso.configure")
    .input(
      z.object({
        enabled: z.boolean(),
        confirmationToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.user.organizationId;
      const userId = ctx.session.user.id;

      const settings = await ctx.prisma.organizationSettings.findUnique({
        where: { organizationId: orgId },
      });
      if (input.enabled && !parseStoredSsoConfig(settings?.ssoConfig)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure and test SSO before enforcing SSO-only login.",
        });
      }

      if (!input.confirmationToken) {
        const window = Math.floor(Date.now() / CONFIRM_WINDOW_MS);
        return {
          applied: false as const,
          requiresConfirmation: true as const,
          confirmationToken: enforcementToken(orgId, userId, input.enabled, window),
          warning: input.enabled
            ? "Enforcing SSO-only login immediately blocks password/Google sign-in for every member of this organization."
            : "Disabling enforcement re-allows non-SSO sign-in for all members.",
        };
      }

      if (
        !isValidEnforcementToken(input.confirmationToken, orgId, userId, input.enabled)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation token is invalid or expired — re-request it.",
        });
      }

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, ssoEnforced: input.enabled },
        update: { ssoEnforced: input.enabled },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: orgId,
        userId,
        action: "SSO_ENFORCEMENT_CHANGED",
        entity: "OrganizationSettings",
        entityId: orgId,
        changes: { enabled: input.enabled, severity: "HIGH" },
      });

      return { applied: true as const, enabled: input.enabled };
    }),

  /**
   * Generates (or rotates) the SCIM bearer token and enables SCIM. The
   * plaintext is returned exactly once; only its SHA-256 hash is stored
   * (deviation from the task brief's "encrypted" wording, flagged in the
   * summary — validate-only secrets shouldn't be recoverable at rest).
   */
  generateScimToken: permissionProcedure("scim.manage").mutation(
    async ({ ctx }) => {
      const orgId = ctx.session.user.organizationId;
      const token = `dscim_${randomBytes(32).toString("hex")}`;
      const tokenHash = createHash("sha256").update(token).digest("hex");

      await ctx.prisma.organizationSettings.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, scimEnabled: true, scimTokenHash: tokenHash },
        update: { scimEnabled: true, scimTokenHash: tokenHash },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: orgId,
        userId: ctx.session.user.id,
        action: "SCIM_TOKEN_GENERATED",
        entity: "OrganizationSettings",
        entityId: orgId,
        changes: { rotated: true },
      });

      return {
        token,
        baseUrl: `${env.NEXTAUTH_URL}/api/scim/v2/${orgId}`,
      };
    },
  ),

  disableScim: permissionProcedure("scim.manage").mutation(async ({ ctx }) => {
    const orgId = ctx.session.user.organizationId;
    await ctx.prisma.organizationSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, scimEnabled: false },
      update: { scimEnabled: false, scimTokenHash: null },
    });

    await emitAuditEvent(ctx.prisma, {
      organizationId: orgId,
      userId: ctx.session.user.id,
      action: "SCIM_DISABLED",
      entity: "OrganizationSettings",
      entityId: orgId,
      changes: null,
    });

    return { scimEnabled: false };
  }),
});
