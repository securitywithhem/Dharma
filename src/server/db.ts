import { PrismaClient } from "@prisma/client";
import { env } from "@/env";

declare global {
  // eslint-disable-next-line no-var
  var __dharmaPrisma: PrismaClient | undefined;
}

const createPrismaClient = () =>
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"]
  });

export const prisma = globalThis.__dharmaPrisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalThis.__dharmaPrisma = prisma;
}
