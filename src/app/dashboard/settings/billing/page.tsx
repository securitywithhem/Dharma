"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { BillingOverview } from "@/components/billing/BillingOverview";
import { PlansComparison } from "@/components/billing/PlansComparison";
import { BillingUsage } from "@/components/billing/BillingUsage";
import { BillingHistory } from "@/components/billing/BillingHistory";

export default function BillingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const initialTab = searchParams?.get("tab") as "overview" | "plans" | "usage" | "history" | null;
  const [activeTab, setActiveTab] = useState<"overview" | "plans" | "usage" | "history">(
    initialTab || "overview"
  );

  useEffect(() => {
    if (searchParams?.get("success")) {
      alert("✅ Payment successful! Your plan has been updated.");
      router.replace("/dashboard/settings/billing" as any);
    } else if (searchParams?.get("canceled")) {
      alert("❌ Payment cancelled.");
      router.replace("/dashboard/settings/billing" as any);
    }
  }, [searchParams, router]);

  // Sync tab state to URL if it changes, without full reload
  const handleTabChange = (tab: "overview" | "plans" | "usage" | "history") => {
    setActiveTab(tab);
    router.replace(`/dashboard/settings/billing?tab=${tab}` as any, { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Billing & Subscription</h1>
        <p className="text-dharma-ink-secondary mt-2">
          Manage your plan, view usage, and invoices.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-dharma-border">
        <nav className="flex space-x-8" aria-label="Billing tabs">
          {[
            { id: "overview", label: "Overview" },
            { id: "plans", label: "Plans & Upgrade" },
            { id: "usage", label: "Usage" },
            { id: "history", label: "Billing History" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? "border-dharma-accent text-dharma-accent-on-tint"
                  : "border-transparent text-dharma-ink-secondary hover:text-dharma-ink hover:border-dharma-border"
              }`}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="min-h-[400px] pt-4">
        {activeTab === "overview" && <BillingOverview />}
        {activeTab === "plans" && <PlansComparison />}
        {activeTab === "usage" && <BillingUsage />}
        {activeTab === "history" && <BillingHistory />}
      </div>
    </div>
  );
}
