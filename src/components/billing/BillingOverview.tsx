"use client";

import React from "react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatPlanPrice } from "./format";

export function BillingOverview() {
  const { data: currentPlan, isLoading: planLoading } = api.billing.getCurrentPlan.useQuery();
  const { data: subscription, isLoading: subLoading } = api.billing.getSubscription.useQuery();

  if (planLoading || subLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Fallback shape must carry `limits` too, or the allowances section silently
  // disappears for any org whose plan has not loaded yet.
  const plan = currentPlan || {
    name: "free",
    displayName: "Free",
    price: 0,
    currency: "USD",
    features: {},
    limits: {},
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Details about your current subscription.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm text-dharma-ink-secondary">Plan Name</p>
            <p className="text-2xl font-bold">{plan.displayName}</p>
          </div>

          {subscription?.status && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <Badge variant={subscription.status === "active" ? "success" : "warning"}>
                {subscription.status.toUpperCase()}
              </Badge>
            </div>
          )}

          {subscription?.currentPeriodEnd && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Renews on</span>
              <span className="text-sm text-dharma-ink-secondary">
                {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(subscription.currentPeriodEnd))}
              </span>
            </div>
          )}
          
          <div className="pt-4 border-t">
            <p className="text-sm text-dharma-ink-secondary mb-1">Price per month</p>
            {/* Currency from the Plan row, not a hardcoded "$": Razorpay
                India sells in INR. */}
            <p className="text-xl font-bold">
              {formatPlanPrice(plan.price, plan.currency)}
              <span className="text-sm font-normal text-dharma-ink-secondary">/mo</span>
            </p>
          </div>
        </CardContent>
        {plan.name !== "enterprise" && (
          <CardFooter className="bg-dharma-surface-hover py-4 border-t flex gap-3 flex-col sm:flex-row">
            <Link href={"/dashboard/settings/billing?tab=plans" as any} className="w-full">
              <Button className="w-full">
                Upgrade Plan
              </Button>
            </Link>
            {/* Points at Dharma's own management screen: Razorpay has no
                hosted billing portal to open. Only offered on a paid plan —
                on Free there is nothing to manage. */}
            {subscription?.plan && plan.name !== "free" && (
              <Link
                href={"/dashboard/settings/billing?tab=manage" as any}
                className="w-full"
              >
                <Button variant="outline" className="w-full">
                  Manage subscription
                </Button>
              </Link>
            )}
          </CardFooter>
        )}
      </Card>

      {/* Plan Features Card */}
      <Card>
        <CardHeader>
          <CardTitle>Features Included</CardTitle>
          <CardDescription>What you have access to on the {plan.displayName} plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* On the Free plan every entry in `features` is false, so this card
              used to render nothing but strikethroughs and read as "you get
              nothing" — while the plan does include real allowances. Those live
              in `plan.limits`, so show them first. Deliberately NOT solved by
              adding positive keys to `features`: that map gates access in
              src/server/services/entitlement.ts, and inventing entries there to
              improve a card would be changing entitlements to fix copy. */}
          {plan.limits && Object.keys(plan.limits).length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-dharma-ink-secondary">
                Included allowances
              </p>
              <ul className="space-y-2">
                {Object.entries(plan.limits as Record<string, unknown>).map(([key, value]) => (
                  <li key={key} className="flex items-center justify-between text-sm">
                    <span className="text-dharma-ink-secondary">{formatFeatureName(key)}</span>
                    <span className="font-medium text-dharma-ink">{formatLimit(key, value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="space-y-4">
            {plan.features ? (
              Object.entries(plan.features).map(([key, enabled]) => (
                <li key={key} className="flex items-center space-x-3">
                  <div className={`p-1 rounded-full ${enabled ? "bg-dharma-success-bg text-dharma-success-text" : "bg-dharma-surface-hover text-dharma-ink-secondary"}`}>
                    {enabled ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </div>
                  <span className={`text-sm ${enabled ? "text-dharma-ink font-medium" : "text-dharma-ink-secondary line-through"}`}>
                    {formatFeatureName(key)}
                  </span>
                </li>
              ))
            ) : (
              <p className="text-sm text-dharma-ink-secondary">No features data available.</p>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** -1 is the convention for "no cap" in Plan.limits; storage is stored in MB. */
function formatLimit(key: string, value: unknown): string {
  if (typeof value !== "number") return String(value ?? "—");
  if (value < 0) return "Unlimited";
  if (/storageMb$/i.test(key)) {
    return value >= 1024 ? `${(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB` : `${value} MB`;
  }
  return value.toLocaleString();
}

function formatFeatureName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}
