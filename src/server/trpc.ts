import { performance } from "node:perf_hooks";
import { PrismaClient, Role } from "@prisma/client";
import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession, type Session } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { trpcRequestDuration } from "@/lib/observability/metrics";
import { authOptions } from "@/server/auth";
import { prisma } from "@/server/db";
import { hasManagementAccess, isAdminRole } from "@/server/rbac";
import {
  AUDITOR_COOKIE_NAME,
  hashAuditorToken
} from "@/server/auditor-access";
import { resolveSessionIdentity } from "@/server/lib/sessionIdentity";

export type PrismaLike = PrismaClient;

type CreateContextOptions = {
  headers: Headers;
  session?: Session | null;
  prismaClient?: PrismaLike;
};

export async function createInnerTRPCContext(options: CreateContextOptions) {
  let session: Session | null =
    options.session ?? (await getServerSession(authOptions));

  let isAuditor = false;
  let auditorTokenExpiry: Date | undefined;

  const cookieHeader = options.headers.get("cookie");

  if (cookieHeader && !session) {
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${AUDITOR_COOKIE_NAME}=([^;]+)`)
    );
    if (match) {
      const tokenHash = hashAuditorToken(decodeURIComponent(match[1]));
      const prismaClient = options.prismaClient ?? prisma;
      const auditorAccess = await prismaClient.auditorAccess.findFirst({
        where: {
          sessionTokenHash: tokenHash,
          isActive: true,
          expiresAt: { gt: new Date() }
        },
      });

      if (auditorAccess) {
        session = {
          user: {
            id: "auditor",
            email: "auditor@dharma",
            name: "Auditor",
            role: Role.VIEWER,
            organizationId: auditorAccess.organizationId,
          },
          expires: auditorAccess.expiresAt.toISOString(),
        };
        isAuditor = true;
        auditorTokenExpiry = auditorAccess.expiresAt;
      }
    }
  }

  return {
    headers: options.headers,
    prisma: options.prismaClient ?? prisma,
    session,
    isAuditor,
    auditorTokenExpiry,
  };
}

export async function createTRPCContext(options: { headers: Headers }) {
  return createInnerTRPCContext({
    headers: options.headers
  });
}

export type TRPCContext = Awaited<ReturnType<typeof createInnerTRPCContext>>;

export const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null
      }
    };
  }
});

const timingMiddleware = t.middleware(async ({ path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const end = performance.now();

  trpcRequestDuration.record(end - start, {
    path,
    type,
    status: result.ok ? "ok" : "error",
  });

  if (process.env.NODE_ENV === "development") {
    console.info(`[tRPC] ${type} ${path} ${Math.round(end - start)}ms`);
  }

  return result;
});

const enforceAuthenticatedUser = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You must be signed in to access this resource."
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: {
        ...ctx.session,
        user: ctx.session.user
      }
    }
  });
});

// WAVE 5.1 (extends WAVE 2.1) — re-read the caller's User row on every request.
//
// This used to check only that the JWT *carried* an organizationId. Because the
// `jwt` callback in auth.ts populates role/organizationId only at sign-in and
// never re-reads the database, that made a 30-day token an unrevokable bearer
// credential: deactivating a member (organization.removeMember) or
// SCIM-deprovisioning them left their open session with full read/write access
// until the token expired, and demoting an ADMIN left the stale role in force.
//
// Everything downstream of this middleware now sees database-resolved values,
// not JWT-asserted ones. The JWT is treated as carrying only an unverified
// `sub`; role and organizationId are overwritten from the row we just read, so
// managerProcedure/adminProcedure (which read ctx.session.user.role) become
// revocation-aware for free, on all 31 routers rather than the 6 that use
// permissionProcedure.
//
// The read is cached for 30s — see src/server/lib/sessionIdentity.ts for the
// staleness/failure-mode reasoning.
const enforceOrganizationContext = t.middleware(async ({ ctx, next }) => {
  const sessionUser = ctx.session?.user;

  if (!sessionUser?.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No organization context is attached to the current session."
    });
  }

  // Auditor sessions are minted from an AuditorAccess row, not a User row
  // (see createInnerTRPCContext), so there is nothing to re-read. That row's
  // own isActive/expiresAt were already checked when the session was built,
  // and preventAuditorMutations keeps the grant read-only.
  if (ctx.isAuditor) {
    return next();
  }

  if (!sessionUser.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const identity = await resolveSessionIdentity(ctx.prisma, sessionUser.id);

  if (!identity) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "This account no longer exists."
    });
  }

  if (!identity.isActive) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account is deactivated."
    });
  }

  if (identity.organizationId !== sessionUser.organizationId) {
    // The token points at an organization the user is no longer a member of —
    // e.g. they were moved between tenants. Refuse rather than silently
    // serving them their new org's data under a token minted for the old one.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your session is no longer valid for this organization."
    });
  }

  return next({
    ctx: {
      ...ctx,
      // Freshly-read identity, so a permission check later in the chain does
      // not have to repeat the lookup.
      identity,
      session: {
        ...ctx.session,
        user: {
          ...sessionUser,
          role: identity.role,
          organizationId: identity.organizationId
        }
      }
    }
  });
});

const enforceManagementRole = t.middleware(({ ctx, next }) => {
  if (!hasManagementAccess(ctx.session?.user.role as Role | undefined)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Management access is required for this action."
    });
  }

  return next();
});

const enforceAdminRole = t.middleware(({ ctx, next }) => {
  if (!isAdminRole(ctx.session?.user.role as Role | undefined)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access is required for this action."
    });
  }

  return next();
});

// WAVE 5.2 — marketplace authorship. The Role enum has carried PUBLISHER since
// the marketplace was added (see 04_TECHNICAL/Authorization.md), but nothing
// ever checked it: marketplace.publishItem had the comment "Basic check, in
// reality verify role is PUBLISHER or ADMIN" above a mutation with no check at
// all, so any signed-in user could publish content every other tenant imports.
const enforcePublisherRole = t.middleware(({ ctx, next }) => {
  const role = ctx.session?.user.role as Role | undefined;
  if (role !== Role.PUBLISHER && !isAdminRole(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Publishing to the marketplace requires the Publisher role."
    });
  }
  return next();
});

// WAVE 5.2 — operator of THIS deployment, not an admin of any tenant.
//
// approveItem/getPendingItems previously gated on `role === "ADMIN"`, which is
// the caller's role inside their OWN organization — so any customer's admin
// could approve any other tenant's submission into the shared catalogue. This
// reads the dedicated User.isPlatformAdmin flag, which no API sets and which is
// never carried in the JWT.
const enforcePlatformAdmin = t.middleware(({ ctx, next }) => {
  const identity = (ctx as { identity?: { isPlatformAdmin?: boolean } }).identity;
  if (!identity?.isPlatformAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action is restricted to platform administrators."
    });
  }
  return next();
});

const preventAuditorMutations = t.middleware(({ ctx, type, next }) => {
  if (ctx.isAuditor && type !== "query") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Auditors have read-only access and cannot perform mutations."
    });
  }
  return next();
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(timingMiddleware);
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceAuthenticatedUser)
  .use(preventAuditorMutations);
export const orgProcedure = protectedProcedure.use(enforceOrganizationContext);
export const managerProcedure = orgProcedure.use(enforceManagementRole);
export const adminProcedure = orgProcedure.use(enforceAdminRole);
/** orgProcedure + PUBLISHER (or ADMIN) — marketplace authorship. */
export const publisherProcedure = orgProcedure.use(enforcePublisherRole);
/**
 * orgProcedure + User.isPlatformAdmin — moderation of the shared catalogue.
 * Built on orgProcedure rather than protectedProcedure so it inherits the
 * WAVE 5.1 identity re-read, which is what populates ctx.identity.
 */
export const platformAdminProcedure = orgProcedure.use(enforcePlatformAdmin);
