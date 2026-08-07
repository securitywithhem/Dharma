import { Role } from "@prisma/client";
import { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      organizationId: string;
      /**
       * GH #22 — epoch seconds at which this session was first established,
       * copied from the JWT's `sessionIssuedAt` claim. Compared against
       * `User.sessionsValidFrom` on every authenticated tRPC call.
       *
       * Optional because tokens minted before #22 shipped do not carry it;
       * `isSessionWithinValidity` treats an absent stamp as revoked whenever a
       * cutoff exists.
       */
      sessionIssuedAt?: number;
    };
  }

  interface User {
    role: Role;
    organizationId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: Role;
    organizationId?: string;
    /** GH #22 — see Session.user.sessionIssuedAt. Written once, at sign-in. */
    sessionIssuedAt?: number;
  }
}
