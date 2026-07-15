// Phase 9 Part 1 — endpoint agent management router.
//
// Human/admin-facing operations only; the agent's own heartbeat is a REST
// route (src/app/api/agent/heartbeat/route.ts) since headless devices can't
// hold a NextAuth session. enroll/revoke are admin-only; list/getChecks are
// org-scoped reads.
//
// DEVIATION (flagged): audit action strings use the repo's SCREAMING_SNAKE
// convention (ENDPOINT_ENROLLED, ENDPOINT_REVOKED, ...) rather than the
// brief's dotted `endpoint.revoked` — every existing AuditLog row and the
// audit.listActions filter dropdown use SCREAMING_SNAKE, and mixing styles
// would fragment the action taxonomy. Same call made in Phase 5/8.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, orgProcedure, adminProcedure } from "@/server/trpc";
import { emitAuditEvent } from "@/server/services/audit/writer";
import {
  generateEnrollmentToken,
  hashEndpointToken,
} from "@/server/lib/endpointAuth";
import { env } from "@/env";

const ENDPOINT_STATUSES = ["PENDING", "ACTIVE", "STALE", "REVOKED"] as const;

export const endpointRouter = createTRPCRouter({
  /**
   * Enroll a new endpoint (admin-only). Creates the row in PENDING and returns
   * the one-time plaintext enrollment token plus a ready-to-paste install
   * command. Only the token's SHA-256 hash is stored.
   */
  enroll: adminProcedure
    .input(
      z.object({
        hostname: z.string().trim().min(1).max(255),
        os: z.string().trim().min(1).max(64),
        osVersion: z.string().trim().min(1).max(64),
        agentVersion: z.string().trim().min(1).max(32).default("0.1.0"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const token = generateEnrollmentToken();
      const endpoint = await ctx.prisma.endpoint.create({
        data: {
          organizationId: ctx.session.user.organizationId,
          hostname: input.hostname,
          os: input.os,
          osVersion: input.osVersion,
          agentVersion: input.agentVersion,
          enrollmentTokenHash: hashEndpointToken(token),
        },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "ENDPOINT_ENROLLED",
        entity: "Endpoint",
        entityId: endpoint.id,
        // Never the token — only non-secret enrollment metadata.
        changes: { hostname: input.hostname, os: input.os },
      });

      const heartbeatUrl = `${env.NEXTAUTH_URL}/api/agent/heartbeat`;
      return {
        endpoint: { id: endpoint.id, hostname: endpoint.hostname, status: endpoint.status },
        // Shown exactly once — the plaintext is never retrievable again.
        enrollmentToken: token,
        // One-line install command mirroring the Cloud Connectors wizard UX.
        installCommand: `curl -fsSL ${env.NEXTAUTH_URL}/agent/install.sh | sh -s -- --token=${token} --server=${heartbeatUrl}`,
      };
    }),

  /** Paginated endpoint list, optionally filtered by status. */
  list: orgProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          cursor: z.string().optional(),
          status: z.enum(ENDPOINT_STATUSES).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.endpoint.findMany({
        where: {
          organizationId: ctx.session.user.organizationId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        select: {
          id: true,
          hostname: true,
          os: true,
          osVersion: true,
          agentVersion: true,
          status: true,
          lastHeartbeatAt: true,
          createdAt: true,
          _count: { select: { checks: true } },
        },
      });

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: data,
        nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
        hasMore,
      };
    }),

  /** Revoke an endpoint (admin-only): future heartbeats are rejected. */
  revoke: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await ctx.prisma.endpoint.findFirst({
        where: { id: input.id, organizationId: ctx.session.user.organizationId },
      });
      if (!endpoint) throw new TRPCError({ code: "NOT_FOUND" });
      if (endpoint.status === "REVOKED") {
        return { id: endpoint.id, status: "REVOKED" as const, alreadyRevoked: true };
      }

      await ctx.prisma.endpoint.update({
        where: { id: endpoint.id },
        data: { status: "REVOKED" },
      });

      await emitAuditEvent(ctx.prisma, {
        organizationId: ctx.session.user.organizationId,
        userId: ctx.session.user.id,
        action: "ENDPOINT_REVOKED",
        entity: "Endpoint",
        entityId: endpoint.id,
        changes: { hostname: endpoint.hostname },
      });

      return { id: endpoint.id, status: "REVOKED" as const, alreadyRevoked: false };
    }),

  /** Checks for one endpoint, filterable by checkType/date range. */
  getChecks: orgProcedure
    .input(
      z.object({
        endpointId: z.string().min(1),
        checkType: z.string().optional(),
        from: z.date().optional(),
        to: z.date().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Tenant guard: confirm the endpoint belongs to the caller's org before
      // returning any of its checks.
      const endpoint = await ctx.prisma.endpoint.findFirst({
        where: { id: input.endpointId, organizationId: ctx.session.user.organizationId },
        select: { id: true },
      });
      if (!endpoint) throw new TRPCError({ code: "NOT_FOUND" });

      const items = await ctx.prisma.endpointCheck.findMany({
        where: {
          endpointId: input.endpointId,
          organizationId: ctx.session.user.organizationId,
          ...(input.checkType ? { checkType: input.checkType } : {}),
          ...(input.from || input.to
            ? {
                collectedAt: {
                  ...(input.from ? { gte: input.from } : {}),
                  ...(input.to ? { lte: input.to } : {}),
                },
              }
            : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { collectedAt: "desc" },
        take: input.limit + 1,
        include: {
          control: { select: { id: true, title: true, domain: true } },
        },
      });

      const hasMore = items.length > input.limit;
      const data = hasMore ? items.slice(0, input.limit) : items;
      return {
        items: data,
        nextCursor: hasMore ? data[data.length - 1]?.id : undefined,
        hasMore,
      };
    }),
});
