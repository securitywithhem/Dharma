import { Role } from "@prisma/client";
import { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      organizationId: string;
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
  }
}
