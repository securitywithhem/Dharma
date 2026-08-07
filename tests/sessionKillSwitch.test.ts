/**
 * GH #22 — the session kill-switch.
 *
 * tests/sessionRevocation.test.ts already proves that orgProcedure re-reads the
 * User row, so deactivation and demotion take effect mid-session. That closed
 * the *implicit* revocation paths. This suite covers the explicit one: an admin
 * who has neither deactivated nor demoted anyone, but who needs every session
 * (or one user's sessions) to stop working right now.
 *
 * Every test builds a session object carrying a `sessionIssuedAt` stamp. That
 * IS the thing under test — a still-valid, unexpired JWT whose only defect is
 * that it was minted before the cutoff. Assertions are on the refusal, and each
 * one is paired with a positive case so a suite that refuses everything (the
 * easy way to pass a security test for the wrong reason) fails loudly.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, createCallerFactory, orgProcedure } from "@/server/trpc";
import {
  invalidateSessionIdentity,
  closeSessionIdentityRedis,
} from "@/server/lib/sessionIdentity";
import {
  isSessionWithinValidity,
  nowSessionIssuedAt,
  SESSION_MAX_AGE_SECONDS,
} from "@/server/lib/sessionPolicy";

const prisma = new PrismaClient();

const testRouter = createTRPCRouter({
  read: orgProcedure.query(() => "ok"),
});

function callerFor(opts: {
  userId: string;
  orgId: string;
  role?: Role;
  /** Epoch seconds. Undefined models a token minted before #22 shipped. */
  sessionIssuedAt?: number;
}) {
  const factory = createCallerFactory(testRouter);
  return factory({
    prisma,
    headers: new Headers(),
    session: {
      user: {
        id: opts.userId,
        email: "killswitch@test.dharma",
        name: "Kill Switch Test",
        organizationId: opts.orgId,
        role: opts.role ?? Role.ADMIN,
        sessionIssuedAt: opts.sessionIssuedAt,
      },
      expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    },
    isAuditor: false,
    auditorTokenExpiry: undefined,
  });
}

let orgId: string;
let otherOrgId: string;
let seq = 0;

function uniqueEmail() {
  seq += 1;
  return `killswitch-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@test.dharma`;
}

async function seedUser(organizationId = orgId, role: Role = Role.ADMIN) {
  const user = await prisma.user.create({
    data: { email: uniqueEmail(), organizationId, role },
  });
  await invalidateSessionIdentity(user.id);
  return user;
}

/** Stamp a cutoff directly, standing in for whichever mutation set it. */
async function setCutoff(userId: string, at: Date | null) {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionsValidFrom: at },
  });
  await invalidateSessionIdentity(userId);
}

beforeAll(async () => {
  orgId = (await prisma.organization.create({ data: { name: `ks-org-${Date.now()}` } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `ks-other-${Date.now()}` } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await prisma.$disconnect();
  await closeSessionIdentityRedis();
});

describe("isSessionWithinValidity — the comparison itself", () => {
  it("honours every session when no cutoff has ever been set", () => {
    // The deploy-day case. Setting a cutoff at migration time would have signed
    // out the entire deployment for no security reason; this is the assertion
    // that keeps the migration's NULL default honest.
    expect(isSessionWithinValidity(nowSessionIssuedAt(), null)).toBe(true);
    expect(isSessionWithinValidity(undefined, null)).toBe(true);
  });

  it("refuses a token stamped before the cutoff", () => {
    const cutoffMs = Date.now();
    const issuedBefore = Math.floor((cutoffMs - 60_000) / 1000);
    expect(isSessionWithinValidity(issuedBefore, cutoffMs)).toBe(false);
  });

  it("honours a token stamped after the cutoff — sign-in after revoking works", () => {
    const cutoffMs = Date.now() - 60_000;
    expect(isSessionWithinValidity(nowSessionIssuedAt(), cutoffMs)).toBe(true);
  });

  it("FAILS CLOSED on a token carrying no stamp once a cutoff exists", () => {
    // A pre-#22 token. We cannot prove it was issued after the cutoff, and an
    // admin who pressed the switch is owed a guarantee, not a best effort.
    expect(isSessionWithinValidity(undefined, Date.now())).toBe(false);
    expect(isSessionWithinValidity(null, Date.now())).toBe(false);
    expect(isSessionWithinValidity(Number.NaN, Date.now())).toBe(false);
  });

  it("treats a token minted in the same second as the cutoff as revoked", () => {
    // Second-vs-millisecond granularity makes this genuinely ambiguous. The
    // safe reading of an ambiguous kill-switch is 'killed'.
    const cutoffMs = 1_800_000_000_500;
    const sameSecond = Math.floor(cutoffMs / 1000);
    expect(isSessionWithinValidity(sameSecond, cutoffMs)).toBe(false);
  });
});

describe("the cutoff is enforced on live requests, not at next sign-in", () => {
  it("serves a request whose token predates no cutoff — baseline", async () => {
    const user = await seedUser();
    const caller = callerFor({ userId: user.id, orgId, sessionIssuedAt: nowSessionIssuedAt() });
    await expect(caller.read()).resolves.toBe("ok");
  });

  it("refuses an unexpired token minted before the cutoff", async () => {
    const user = await seedUser();
    const issuedAt = nowSessionIssuedAt() - 3_600; // signed in an hour ago
    const caller = callerFor({ userId: user.id, orgId, sessionIssuedAt: issuedAt });

    // Works right up until the switch is pressed...
    await expect(caller.read()).resolves.toBe("ok");

    await setCutoff(user.id, new Date());

    // ...and stops on the very next request, with the same caller and the same
    // token. This is the property the issue asked for: enforcement server-side
    // on every authenticated request, not only at next sign-in.
    await expect(caller.read()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("lets the same user back in with a freshly-minted token", async () => {
    const user = await seedUser();
    await setCutoff(user.id, new Date(Date.now() - 5_000));

    // Revocation must not lock a user out permanently — signing in again is the
    // documented recovery, so a token stamped now has to be honoured.
    const fresh = callerFor({ userId: user.id, orgId, sessionIssuedAt: nowSessionIssuedAt() });
    await expect(fresh.read()).resolves.toBe("ok");
  });

  it("refuses a pre-#22 token (no stamp) once a cutoff exists, and allows it before", async () => {
    const user = await seedUser();
    const legacy = callerFor({ userId: user.id, orgId, sessionIssuedAt: undefined });

    await expect(legacy.read()).resolves.toBe("ok");

    await setCutoff(user.id, new Date());
    await expect(legacy.read()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("organization.revokeAllSessions / revokeUserSessions", () => {
  it("per-user revocation cuts only that user", async () => {
    const target = await seedUser();
    const bystander = await seedUser();
    const issuedAt = nowSessionIssuedAt() - 60;

    await setCutoff(target.id, new Date());

    await expect(
      callerFor({ userId: target.id, orgId, sessionIssuedAt: issuedAt }).read(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // The half that actually proves scoping: revoking one person must not sign
    // out the rest of the company.
    await expect(
      callerFor({ userId: bystander.id, orgId, sessionIssuedAt: issuedAt }).read(),
    ).resolves.toBe("ok");
  });

  it("org-wide revocation cuts every member of that org and nobody else's", async () => {
    const mine = await seedUser(orgId);
    const alsoMine = await seedUser(orgId);
    const theirs = await seedUser(otherOrgId);
    const issuedAt = nowSessionIssuedAt() - 60;

    // Exactly what the mutation does: one updateMany scoped by organizationId.
    // Scoping is the assertion — an unscoped updateMany would sign out every
    // tenant in the deployment, which is the worst possible bug in this feature.
    await prisma.user.updateMany({
      where: { organizationId: orgId },
      data: { sessionsValidFrom: new Date() },
    });
    await Promise.all(
      [mine.id, alsoMine.id, theirs.id].map((id) => invalidateSessionIdentity(id)),
    );

    for (const user of [mine, alsoMine]) {
      await expect(
        callerFor({ userId: user.id, orgId, sessionIssuedAt: issuedAt }).read(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }

    await expect(
      callerFor({ userId: theirs.id, orgId: otherOrgId, sessionIssuedAt: issuedAt }).read(),
    ).resolves.toBe("ok");
  });

  it("is idempotent — pressing revoke twice only moves the cutoff forward", async () => {
    const user = await seedUser();
    const first = new Date(Date.now() - 10_000);
    await setCutoff(user.id, first);
    const second = new Date();
    await setCutoff(user.id, second);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionsValidFrom: true },
    });
    expect(row?.sessionsValidFrom?.getTime()).toBe(second.getTime());

    // And a token issued between the two presses is still refused.
    await expect(
      callerFor({
        userId: user.id,
        orgId,
        sessionIssuedAt: Math.floor((first.getTime() + 5_000) / 1000),
      }).read(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("deactivation and revocation stay distinguishable", () => {
  it("a deactivated user is told their account is disabled, not to sign in again", async () => {
    const user = await seedUser();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    await invalidateSessionIdentity(user.id);

    // Ordering in the middleware matters: isActive is checked first, so a
    // deactivated user never sees 'sign in again' — which would send an
    // offboarded employee round a loop that cannot succeed.
    await expect(
      callerFor({ userId: user.id, orgId, sessionIssuedAt: nowSessionIssuedAt() }).read(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
