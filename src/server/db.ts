import { PrismaClient } from "@prisma/client";
import { env } from "@/env";

declare global {
  // eslint-disable-next-line no-var
  var __dharmaPrisma: PrismaClient | undefined;
}

const createPrismaClient = () => {
  const client = new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"]
  });

  // WAVE 5.1 — keep the session-identity cache honest.
  //
  // orgProcedure resolves the caller's role/isActive/organizationId through a
  // 30s-TTL cache (src/server/lib/sessionIdentity.ts). The TTL alone is the
  // correctness guarantee, but a deactivated user staying live for up to 30
  // more seconds is a poor answer for the offboarding flow specifically, so we
  // also invalidate eagerly.
  //
  // Done here, at the client, rather than at the ~14 `user.update` /
  // `user.updateMany` call sites (7 of them in SCIM alone): a scheme where
  // access revocation depends on every author remembering to call an
  // invalidator fails silently the first time someone adds a 15th call site.
  // This catches them all, including ones not written yet.
  client.$use(async (params, next) => {
    const result = await next(params);

    if (
      params.model === "User" &&
      (params.action === "update" ||
        params.action === "updateMany" ||
        params.action === "delete" ||
        params.action === "deleteMany" ||
        params.action === "upsert")
    ) {
      // Imported lazily so db.ts stays free of a Redis dependency at module
      // load — importing this eagerly would make every consumer of `prisma`
      // (including scripts and migrations) open a Redis connection.
      const { invalidateSessionIdentity } = await import(
        "@/server/lib/sessionIdentity"
      );

      // `update`/`delete` carry a unique where; the *Many variants and upsert
      // may not resolve to a single id, so fall back to clearing by the ids we
      // can see. A miss here only means "stale for up to the TTL".
      const id =
        typeof params.args?.where?.id === "string"
          ? params.args.where.id
          : typeof (result as { id?: unknown } | null)?.id === "string"
            ? (result as { id: string }).id
            : null;

      if (id) {
        await invalidateSessionIdentity(id);
      }
    }

    return result;
  });

  return client;
};

export const prisma = globalThis.__dharmaPrisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalThis.__dharmaPrisma = prisma;
}
