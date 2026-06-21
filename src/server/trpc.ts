import { performance } from "node:perf_hooks";
import { PrismaClient, Role } from "@prisma/client";
import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession, type Session } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { authOptions } from "@/server/auth";
import { prisma } from "@/server/db";
import { hasManagementAccess, isAdminRole } from "@/server/rbac";

export type PrismaLike = PrismaClient;

type CreateContextOptions = {
  headers: Headers;
  session?: Session | null;
  prismaClient?: PrismaLike;
};

export async function createInnerTRPCContext(options: CreateContextOptions) {
  const session: Session | null =
    options.session ?? (await getServerSession(authOptions));

  return {
    headers: options.headers,
    prisma: options.prismaClient ?? prisma,
    session
  };
}

export async function createTRPCContext(options: { headers: Headers }) {
  return createInnerTRPCContext({
    headers: options.headers
  });
}

export type TRPCContext = Awaited<ReturnType<typeof createInnerTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
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

const enforceOrganizationContext = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user.organizationId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "No organization context is attached to the current session."
    });
  }

  return next();
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

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(timingMiddleware);
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(enforceAuthenticatedUser);
export const orgProcedure = protectedProcedure.use(enforceOrganizationContext);
export const managerProcedure = orgProcedure.use(enforceManagementRole);
export const adminProcedure = orgProcedure.use(enforceAdminRole);
