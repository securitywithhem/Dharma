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
import { connectorRouter } from "@/server/routers/connector";
import { evidenceMappingRouter } from "@/server/routers/evidenceMapping";
import { billingRouter } from "@/server/routers/billing";
import { entitlementRouter } from "@/server/routers/entitlement";
import { marketplaceRouter } from "@/server/routers/marketplace";
import { importRouter } from "@/server/routers/import";

export const appRouter = createTRPCRouter({
  audit: auditRouter,
  policy: policyRouter,
  dashboard: dashboardRouter,
  report: reportRouter,
  evidence: evidenceRouter,
  control: controlRouter,
  framework: frameworkRouter,
  health: healthRouter,
  settings: settingsRouter,
  onboarding: onboardingRouter,
  connector: connectorRouter,
  evidenceMapping: evidenceMappingRouter,
  billing: billingRouter,
  entitlement: entitlementRouter,
  marketplace: marketplaceRouter,
  import: importRouter,
});

export type AppRouter = typeof appRouter;
