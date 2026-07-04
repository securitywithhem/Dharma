/**
 * src/server/routers/connector.ts
 *
 * Phase 2 Feature 2 — Automated Evidence Connector tRPC router.
 *
 * Procedures:
 *   list      – list connectors for the org with last-run status
 *   create    – validate input, encrypt credential, test connectivity, persist
 *   runNow    – enqueue an immediate connector-sync job
 *   delete    – remove a connector (+ AuditLog)
 *
 * SECURITY: Encrypted credentials are NEVER returned in any response.
 *           Cross-org access is enforced by always filtering with organizationId from session.
 *
 * [skills: backend-dev-guidelines, broken-authentication]
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ConnectorProvider, ConnectorStatus } from "@prisma/client";
import { createTRPCRouter, managerProcedure, orgProcedure } from "@/server/trpc";
import { createAuditLog } from "@/server/audit-log";
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";
import { connectorQueue, type ConnectorJobData } from "@/workers/connectors/index";

// ── Validation schemas ────────────────────────────────────────────────────────

const GitHubConfigSchema = z.object({
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Must be owner/repo format")),
});

const AWSConfigSchema = z.object({
  regions: z.array(z.string().min(1)),
  accessKeyId: z.string().min(16),
  secretAccessKey: z.string().min(32),
});

const VercelConfigSchema = z.object({
  projectIds: z.array(z.string().min(1)),
  teamId: z.string().optional(),
});

const CreateConnectorSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal(ConnectorProvider.GITHUB),
    displayName: z.string().min(1).max(120),
    /** PAT with repo:read scope — stored encrypted, never returned */
    pat: z.string().min(1),
    config: GitHubConfigSchema,
  }),
  z.object({
    provider: z.literal(ConnectorProvider.AWS),
    displayName: z.string().min(1).max(120),
    accessKeyId: z.string().min(16),
    secretAccessKey: z.string().min(32),
    config: AWSConfigSchema,
  }),
  z.object({
    provider: z.literal(ConnectorProvider.VERCEL),
    displayName: z.string().min(1).max(120),
    /** Vercel API token — stored encrypted, never returned */
    token: z.string().min(1),
    config: VercelConfigSchema,
  }),
]);

// ── Connectivity test helpers ─────────────────────────────────────────────────

async function testGitHubConnection(pat: string): Promise<void> {
  const { Octokit } = await import("@octokit/rest");
  const octokit = new Octokit({ auth: pat });
  const { data } = await octokit.users.getAuthenticated();
  console.log(`[connector:github] Connection test OK — authenticated as @${data.login}`);
}

async function testAWSConnection(accessKeyId: string, secretAccessKey: string): Promise<void> {
  const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({ region: "us-east-1", credentials: { accessKeyId, secretAccessKey } });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  console.log(`[connector:aws] Connection test OK — account ${identity.Account}`);
}

async function testVercelConnection(token: string): Promise<void> {
  const res = await fetch("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Vercel API returned ${res.status}`);
  const data = (await res.json()) as { user?: { username?: string } };
  console.log(`[connector:vercel] Connection test OK — user ${data.user?.username}`);
}

// ── Router ────────────────────────────────────────────────────────────────────

export const connectorRouter = createTRPCRouter({
  /**
   * List all connectors for the org.
   * Credentials are NEVER included in the response.
   */
  list: orgProcedure.query(async ({ ctx }) => {
    const connectors = await ctx.prisma.connector.findMany({
      where: { organizationId: ctx.session.user.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        displayName: true,
        config: true,
        status: true,
        lastRunAt: true,
        lastRunStatus: true,
        createdAt: true,
        // credentials intentionally omitted
      },
    });
    return connectors;
  }),

  /**
   * Create a new connector.
   * Tests connectivity before persisting. Encrypts credentials in DB.
   */
  create: managerProcedure
    .input(CreateConnectorSchema)
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Test connectivity synchronously (fail fast, don't save bad creds)
      try {
        if (input.provider === ConnectorProvider.GITHUB) {
          await testGitHubConnection(input.pat);
        } else if (input.provider === ConnectorProvider.AWS) {
          await testAWSConnection(input.accessKeyId, input.secretAccessKey);
        } else if (input.provider === ConnectorProvider.VERCEL) {
          await testVercelConnection(input.token);
        }
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Connection test failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Encrypt credential before storage
      let encryptedCredential: string;
      if (input.provider === ConnectorProvider.GITHUB) {
        encryptedCredential = encryptCredential(input.pat);
      } else if (input.provider === ConnectorProvider.AWS) {
        encryptedCredential = encryptCredential(
          JSON.stringify({ accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey }),
        );
      } else {
        encryptedCredential = encryptCredential(input.token);
      }

      // Strip credential fields from config for DB storage
      const { provider, displayName } = input;
      const dbConfig =
        provider === ConnectorProvider.GITHUB
          ? input.config
          : provider === ConnectorProvider.AWS
            ? { regions: input.config.regions }
            : input.config;

      const connector = await ctx.prisma.connector.create({
        data: {
          organizationId,
          provider,
          displayName,
          credentials: encryptedCredential,
          config: dbConfig as any,
          status: ConnectorStatus.ACTIVE,
        },
        select: {
          id: true,
          provider: true,
          displayName: true,
          config: true,
          status: true,
          createdAt: true,
        },
      });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_CREATED",
        entity: "Connector",
        entityId: connector.id,
        changes: { provider, displayName },
      });

      return connector;
    }),

  /**
   * Trigger an immediate sync for a specific connector.
   */
  runNow: managerProcedure
    .input(z.object({ connectorId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      // Verify the connector belongs to this org (cross-org check)
      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.connectorId, organizationId },
        select: { id: true },
      });

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found." });
      }

      const job = await connectorQueue.add(
        "manual-sync",
        { connectorId: input.connectorId, organizationId } satisfies ConnectorJobData,
        { priority: 1 },
      );

      return { jobId: job.id };
    }),

  /**
   * Delete a connector and all its auto-generated evidence rows.
   */
  delete: managerProcedure
    .input(z.object({ connectorId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.user.organizationId;

      const connector = await ctx.prisma.connector.findFirst({
        where: { id: input.connectorId, organizationId },
        select: { id: true, provider: true, displayName: true },
      });

      if (!connector) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connector not found." });
      }

      await ctx.prisma.connector.delete({ where: { id: input.connectorId } });

      await createAuditLog(ctx.prisma, {
        organizationId,
        userId: ctx.session.user.id,
        action: "CONNECTOR_DELETED",
        entity: "Connector",
        entityId: input.connectorId,
        changes: { provider: connector.provider, displayName: connector.displayName },
      });

      return { deleted: true };
    }),
});
