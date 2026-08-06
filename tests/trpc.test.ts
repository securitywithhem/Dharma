process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://dharma:dharma_secure_password_change_me@localhost:5432/dharma_db?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ?? "replace-with-a-random-32-character-secret";
process.env.MINIO_PORT = process.env.MINIO_PORT ?? "9000";

jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null)
}));

jest.mock("@/server/auth", () => ({
  authOptions: {}
}));

import { createInnerTRPCContext } from "@/server/trpc";
import { appRouter } from "@/server/routers";
import {
  invalidateSessionIdentity,
  closeSessionIdentityRedis
} from "@/server/lib/sessionIdentity";

// WAVE 5.1: orgProcedure re-reads the caller's User row on every request
// (src/server/lib/sessionIdentity.ts), and treats the role it finds there as
// authoritative over the one in the session. A mock prisma therefore has to
// model that row, and — for the VIEWER case below — has to model it with the
// role actually under test, since asserting a role only in the session is no
// longer a way to hold it.
function createMockPrisma(
  user: { id: string; role: string; organizationId: string } = {
    id: "user_1",
    role: "ADMIN",
    organizationId: "org_1"
  }
) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ ...user, isActive: true, customRoleId: null })
    },
    framework: {
      findMany: jest.fn().mockResolvedValue([])
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: "org_1",
        name: "Dharma Demo Organization",
        _count: {
          users: 1,
          frameworks: 2,
          policies: 0,
          evidences: 0
        }
      })
    }
  };
}

describe("tRPC foundation", () => {
  beforeEach(async () => {
    // user_1/user_2 are fixed ids and the identity cache lives in a real Redis
    // that outlives this process — clear them so a previous run (or another
    // suite using the same ids) can never satisfy these lookups.
    await invalidateSessionIdentity("user_1");
    await invalidateSessionIdentity("user_2");
  });

  afterAll(async () => {
    await closeSessionIdentityRedis();
  });

  it("rejects protected procedures without a session", async () => {
    const mockPrisma = createMockPrisma();
    const ctx = await createInnerTRPCContext({
      headers: new Headers(),
      session: null,
      prismaClient: mockPrisma as never
    });

    const caller = appRouter.createCaller(ctx);

    await expect(caller.framework.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED"
    });
  });

  it("applies organization scoping to framework queries", async () => {
    const mockPrisma = createMockPrisma();
    const ctx = await createInnerTRPCContext({
      headers: new Headers(),
      session: {
        user: {
          id: "user_1",
          email: "admin@example.com",
          role: "ADMIN",
          organizationId: "org_1"
        },
        expires: new Date(Date.now() + 60_000).toISOString()
      } as never,
      prismaClient: mockPrisma as never
    });

    const caller = appRouter.createCaller(ctx);
    await caller.framework.list();

    expect(mockPrisma.framework.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org_1"
        }
      }),
    );
  });

  it("blocks admin routes for viewer roles", async () => {
    const mockPrisma = createMockPrisma({
      id: "user_2",
      role: "VIEWER",
      organizationId: "org_1"
    });
    const ctx = await createInnerTRPCContext({
      headers: new Headers(),
      session: {
        user: {
          id: "user_2",
          email: "viewer@example.com",
          role: "VIEWER",
          organizationId: "org_1"
        },
        expires: new Date(Date.now() + 60_000).toISOString()
      } as never,
      prismaClient: mockPrisma as never
    });

    const caller = appRouter.createCaller(ctx);

    await expect(caller.settings.createAuditorKey({ duration: "1d" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });
});
