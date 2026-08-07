/**
 * WAVE 5.1 (extends WAVE 2.1) — session revocation on orgProcedure.
 *
 * Closes fullstack-audit-2026-08-06 BE-1: auth is a 30-day JWT whose `jwt`
 * callback populates role/organizationId only at sign-in and never re-reads
 * the database, so deactivating or demoting a user did not revoke their
 * access on the 25 routers that don't use permissionProcedure.
 *
 * Every test here builds a session object directly — that is precisely a
 * still-valid, not-yet-expired JWT carrying claims that were true when it was
 * minted. The assertions are on the *rejection* path: a live orgProcedure call
 * must refuse, not merely record isActive: false somewhere.
 *
 * All of these pass trivially on the pre-fix code for the wrong reason if you
 * assert only on the happy path, so each one pins a specific refusal.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createCallerFactory, orgProcedure } from "@/server/trpc";
import {
  invalidateSessionIdentity,
  closeSessionIdentityRedis,
} from "@/server/lib/sessionIdentity";

const prisma = new PrismaClient();

// A minimal router standing in for any of the 25 org routers that previously
// had no revocation check at all.
const testRouter = createTRPCRouter({
  read: orgProcedure.query(() => "ok"),
  // Echoes what the middleware resolved, so we can prove downstream procedures
  // see database-resolved values rather than the JWT's stale claims.
  whoAmI: orgProcedure.query(({ ctx }) => ({
    role: ctx.session.user.role,
    organizationId: ctx.session.user.organizationId,
  })),
});

function callerFor(opts: {
  userId: string;
  orgId: string;
  role?: Role;
  isAuditor?: boolean;
}) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: opts.userId,
        email: "revocation@test.dharma",
        name: "Revocation Test",
        organizationId: opts.orgId,
        role: opts.role ?? Role.ADMIN,
      },
      expires: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
    isAuditor: opts.isAuditor ?? false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;
let otherOrgId: string;

let seq = 0;
function uniqueEmail() {
  seq += 1;
  return `revocation-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dharma`;
}

async function seedUser(role: Role = Role.ADMIN, organizationId = orgId) {
  const user = await prisma.user.create({
    data: { email: uniqueEmail(), organizationId, role },
  });
  // Each test seeds a fresh id, so the cache starts empty — but be explicit
  // rather than relying on that, since a stale entry here would make a
  // revocation test pass for the wrong reason.
  await invalidateSessionIdentity(user.id);
  return user;
}

beforeAll(async () => {
  orgId = (
    await prisma.organization.create({ data: { name: `revocation-org-${Date.now()}` } })
  ).id;
  otherOrgId = (
    await prisma.organization.create({ data: { name: `revocation-other-${Date.now()}` } })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("orgProcedure re-reads the user row (BE-1)", () => {
  it("allows an active member — baseline, so the refusals below mean something", async () => {
    const user = await seedUser();
    await expect(callerFor({ userId: user.id, orgId }).read()).resolves.toBe("ok");
  });

  it("refuses a deactivated user holding a still-valid JWT", async () => {
    const user = await seedUser();

    // The offboarding path: organization.removeMember / SCIM deprovision both
    // soft-delete exactly this way (isActive: false, row retained).
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await invalidateSessionIdentity(user.id);

    // The token is unchanged and unexpired. Pre-fix this resolved to "ok".
    const caller = callerFor({ userId: user.id, orgId });
    await expect(caller.read()).rejects.toThrow(TRPCError);
    await expect(caller.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a deactivated user even with no cache invalidation at all", async () => {
    // Belt-and-braces: proves the guarantee does not depend on the
    // invalidation hook firing. A user deactivated out of band (a DBA, a
    // restored backup) is refused on the first uncached request.
    const user = await seedUser();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(callerFor({ userId: user.id, orgId }).read()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a user whose row was deleted outright", async () => {
    const user = await seedUser();
    await prisma.user.delete({ where: { id: user.id } });
    await invalidateSessionIdentity(user.id);

    await expect(callerFor({ userId: user.id, orgId }).read()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("refuses a token minted for an organization the user has since left", async () => {
    const user = await seedUser(Role.ADMIN, otherOrgId);
    await invalidateSessionIdentity(user.id);

    // Token says orgId; the row says otherOrgId. Serving this would hand the
    // caller a different tenant's data under a token minted elsewhere.
    await expect(callerFor({ userId: user.id, orgId }).read()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("role demotion takes effect without re-issuing the token (BE-1)", () => {
  it("serves the database role, not the role embedded in the JWT", async () => {
    const user = await seedUser(Role.VIEWER);

    // The JWT still claims ADMIN — this is the demotion case: the user was an
    // admin when they signed in, and was demoted after.
    const result = await callerFor({ userId: user.id, orgId, role: Role.ADMIN }).whoAmI();

    expect(result.role).toBe(Role.VIEWER);
    expect(result.organizationId).toBe(orgId);
  });

  it("picks up a promotion the same way, in the same request path", async () => {
    const user = await seedUser(Role.VIEWER);
    await prisma.user.update({ where: { id: user.id }, data: { role: Role.ADMIN } });
    await invalidateSessionIdentity(user.id);

    const result = await callerFor({ userId: user.id, orgId, role: Role.VIEWER }).whoAmI();
    expect(result.role).toBe(Role.ADMIN);
  });
});

describe("auditor sessions are unaffected", () => {
  it("does not try to re-read a User row for an auditor session", async () => {
    // Auditor sessions are minted from an AuditorAccess row and carry a
    // synthetic user id with no matching User row. If the middleware tried to
    // resolve it, every auditor query would 401 — a regression this pins.
    const caller = callerFor({
      userId: "auditor",
      orgId,
      role: Role.VIEWER,
      isAuditor: true,
    });

    await expect(caller.read()).resolves.toBe("ok");
  });
});
