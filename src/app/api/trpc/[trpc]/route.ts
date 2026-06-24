import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers";
import { createTRPCContext } from "@/server/trpc";

const handler = (request: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => {
      console.log(`[TRPC INCOMING] URL: ${request.url}`);
      console.log(`[TRPC INCOMING] Cookie: ${request.headers.get("cookie")}`);
      return createTRPCContext({
        headers: request.headers
      });
    },
    onError:
      process.env.NODE_ENV === "development"
        ? ({ error, path }) => {
            console.error(`tRPC failed on ${path ?? "<unknown>"}`, error);
          }
        : undefined
  });

export { handler as GET, handler as POST };
