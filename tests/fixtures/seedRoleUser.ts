/**
 * Seed a real User row carrying a specific Role.
 *
 * WAVE 5.1 made the database authoritative for role and membership:
 * orgProcedure re-reads the caller's User row on every request and overwrites
 * the session's role with what it finds (src/server/lib/sessionIdentity.ts).
 *
 * Before that, an RBAC test could become a VIEWER just by passing
 * `Role.VIEWER` into the session while the seeded row said ADMIN. That is
 * exactly the escalation BE-1 describes — a token asserting a privilege the
 * database does not agree with — so it is no longer a way to become a viewer,
 * and tests that did it were passing for a reason that no longer holds.
 *
 * Use this to express the role where it now counts. Callers should still pass
 * the same role into the session, so the fixture reads as a *consistent*
 * session rather than a deliberately-stale one.
 */
import type { PrismaClient, Role } from "@prisma/client";
import { invalidateSessionIdentity } from "@/server/lib/sessionIdentity";

let seq = 0;

export async function seedRoleUser(
  prisma: PrismaClient,
  organizationId: string,
  role: Role,
  label = "rbac"
) {
  seq += 1;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${role.toLowerCase()}-${Date.now()}-${seq}-${Math.random()
        .toString(36)
        .slice(2, 8)}@test.dharma`,
      name: `${label} ${role}`,
      role,
      organizationId,
    },
  });

  // The identity cache lives in a real Redis that outlives a single jest
  // process. Ids here are unique so a collision is near-impossible, but clear
  // it anyway — a stale hit would make an RBAC assertion pass or fail for a
  // reason that has nothing to do with the code under test.
  await invalidateSessionIdentity(user.id);

  return user;
}
