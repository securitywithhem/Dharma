import { createTRPCRouter } from "@/server/trpc";
import { auditRouter } from "@/server/routers/audit";
import { controlRouter } from "@/server/routers/control";
import { evidenceRouter } from "@/server/routers/evidence";
import { frameworkRouter } from "@/server/routers/framework";
import { policyRouter } from "@/server/routers/policy";
import { settingsRouter } from "@/server/routers/settings";

export const appRouter = createTRPCRouter({
  audit: auditRouter,
  control: controlRouter,
  evidence: evidenceRouter,
  framework: frameworkRouter,
  policy: policyRouter,
  settings: settingsRouter
});

export type AppRouter = typeof appRouter;
