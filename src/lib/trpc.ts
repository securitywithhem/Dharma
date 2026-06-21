import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers";

export const api = createTRPCReact<AppRouter>();

export function getBaseUrl() {
  if (typeof window !== "undefined") {
    return "";
  }

  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }

  return "http://localhost:3000";
}

export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
