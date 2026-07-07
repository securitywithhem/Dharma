"use client";

import React, { useState } from "react";
import { api } from "@/hooks/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PlansComparison() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  
  const { data: plans, isLoading } = api.billing.getPlans.useQuery();
  const { data: currentPlan } = api.billing.getCurrentPlan.useQuery();
  const createCheckout = api.billing.createCheckoutSession.useMutation();

  const handleSelectPlan = async (planId: string) => {
    const plan = plans?.find((p) => p.id === planId);
    if (!plan?.stripePriceId) {
      alert("Cannot process checkout for this plan. Please contact support.");
      return;
    }

    setSelectedPlan(planId);

    try {
      const result = await createCheckout.mutateAsync({
        planId,
        successUrl: `${window.location.origin}/dashboard/settings/billing?success=true`,
        cancelUrl: `${window.location.origin}/dashboard/settings/billing?canceled=true`,
      });

      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      alert("Failed to initiate checkout. Please try again.");
      setSelectedPlan(null);
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Pre-defined set of all features to compare
  const allFeatures = ["apiAccess", "sso", "advancedAutomation", "aiAdvisor"];

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans?.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          const limits = plan.limits as Record<string, number>;
          
          return (
            <Card key={plan.id} className={`relative flex flex-col ${isCurrent ? "border-primary shadow-md" : ""}`}>
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-xs font-semibold shadow-sm">
                    Current Plan
                  </span>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{plan.displayName}</CardTitle>
                <div className="mt-4 flex items-baseline">
                  <span className="text-4xl font-bold tracking-tight">${(plan.price || 0).toFixed(0)}</span>
                  <span className="text-muted-foreground ml-1 text-sm font-medium">/month</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm">Top Features</h4>
                  <ul className="space-y-3">
                    {plan.features && Object.entries(plan.features)
                      .filter(([_, enabled]) => enabled)
                      .slice(0, 4) // Show only up to 4 top features in card
                      .map(([key]) => (
                        <li key={key} className="flex items-start gap-3">
                          <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                          <span className="text-sm text-muted-foreground">{formatFeatureName(key)}</span>
                        </li>
                      ))
                    }
                  </ul>

                  <div className="mt-6 pt-6 border-t border-border space-y-3">
                    <p className="text-sm font-semibold">Usage Limits</p>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li className="flex justify-between">
                        <span>Users</span>
                        <span className="font-medium text-foreground">{limits?.users || "Unlimited"}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Frameworks</span>
                        <span className="font-medium text-foreground">{limits?.frameworks || "Unlimited"}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Storage (MB)</span>
                        <span className="font-medium text-foreground">{limits?.storageMb || "Unlimited"}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={isCurrent ? "secondary" : "default"}
                  disabled={isCurrent || (selectedPlan === plan.id) || (!plan.stripePriceId && plan.name !== "free")}
                  onClick={() => handleSelectPlan(plan.id)}
                >
                  {isCurrent
                    ? "Current Plan"
                    : selectedPlan === plan.id
                    ? "Redirecting..."
                    : "Select Plan"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Comparison Table */}
      <div className="mt-16">
        <h3 className="text-xl font-semibold mb-6">Detailed Comparison</h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">Feature</TableHead>
                {plans?.map((plan) => (
                  <TableHead key={plan.id} className="text-center font-semibold">
                    {plan.displayName}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {allFeatures.map((feature) => (
                <TableRow key={feature}>
                  <TableCell className="font-medium">
                    {formatFeatureName(feature)}
                  </TableCell>
                  {plans?.map((plan) => {
                    const hasFeature = (plan.features as any)?.[feature];
                    return (
                      <TableCell key={plan.id} className="text-center">
                        {hasFeature ? (
                          <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto" />
                        ) : (
                          <XCircle className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function formatFeatureName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}
