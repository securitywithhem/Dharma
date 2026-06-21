process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://dharma:dharma_secure_password_change_me@localhost:5432/dharma_db?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ?? "replace-with-a-random-32-character-secret";
process.env.MINIO_PORT = process.env.MINIO_PORT ?? "9000";

import type { JWT } from "next-auth/jwt";
import { authCapabilities, authOptions } from "@/server/auth";
import { hasManagementAccess, isAdminRole } from "@/server/rbac";

describe("auth foundation", () => {
  it("attaches user claims to the JWT and session", async () => {
    const jwt = (await authOptions.callbacks?.jwt?.({
      token: {},
      user: {
        id: "user_1",
        role: "ADMIN",
        organizationId: "org_1"
      } as never,
      account: null,
      profile: undefined,
      trigger: "signIn",
      isNewUser: false,
      session: undefined
    } as never)) as JWT;

    expect(jwt.sub).toBe("user_1");
    expect(jwt.role).toBe("ADMIN");
    expect(jwt.organizationId).toBe("org_1");

    const session = (await authOptions.callbacks?.session?.({
      session: {
        user: {
          email: "admin@example.com",
          name: "Admin"
        },
        expires: new Date(Date.now() + 60_000).toISOString()
      },
      token: jwt,
      user: undefined,
      newSession: undefined,
      trigger: "update"
    } as never)) as {
      user: {
        id: string;
        role: string;
        organizationId: string;
      };
    };

    expect(session.user.id).toBe("user_1");
    expect(session.user.role).toBe("ADMIN");
    expect(session.user.organizationId).toBe("org_1");
  });

  it("exposes a working fallback magic-link provider", () => {
    expect(authCapabilities.email).toBe(true);
  });

  it("enforces RBAC helpers", () => {
    expect(hasManagementAccess("ADMIN")).toBe(true);
    expect(hasManagementAccess("COMPLIANCE_MANAGER")).toBe(true);
    expect(hasManagementAccess("VIEWER")).toBe(false);
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole("VIEWER")).toBe(false);
  });
});
