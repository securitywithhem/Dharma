import type { Metadata } from "next";

// `template` must be restated here: a nested layout that sets a plain string
// title replaces the parent's template for its whole subtree, which would
// strip "| Dharma" from every page under /dashboard.
export const metadata: Metadata = {
  title: { default: "Compliance Status", template: "%s | Dharma" },
};

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import type { ReactNode } from "react";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import { AIAdvisorTrigger } from "@/components/ai-advisor/AIAdvisorTrigger";
import { authOptions } from "@/server/auth";

export default async function DashboardShell({
  children
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/dashboard");
  }

  return (
    <DashboardLayout>
      {children}
      {/* Phase 7 Part 3 — AI Advisor available across the dashboard. */}
      <AIAdvisorTrigger />
    </DashboardLayout>
  );
}
