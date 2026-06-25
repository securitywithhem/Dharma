import { createTRPCRouter } from "@/server/trpc";
import { auditRouter } from "@/server/routers/audit";
import { controlRouter } from "@/server/routers/control";
import { evidenceRouter } from "@/server/routers/evidence";
import { frameworkRouter } from "@/server/routers/framework";
import { healthRouter } from "@/server/routers/health";
import { policyRouter } from "@/server/routers/policy";
import { settingsRouter } from "@/server/routers/settings";
import { reportRouter } from "@/server/routers/report";
import { dashboardRouter } from "@/server/routers/dashboard";
import { onboardingRouter } from "@/server/routers/onboarding";

export const appRouter = createTRPCRouter({
  audit: auditRouter,
  control: controlRouter,
  evidence: evidenceRouter,
  framework: frameworkRouter,
  health: healthRouter,
  policy: policyRouter,
  settings: settingsRouter,
  report: reportRouter,
  dashboard: dashboardRouter,
  onboarding: onboardingRouter
});

export type AppRouter = typeof appRouter;
