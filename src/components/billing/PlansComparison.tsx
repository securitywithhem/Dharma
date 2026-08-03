"use client";

// Phase 3b/3c — plan selection.
//
// Phase 3c made the upgrade button provider-aware. The two providers hand off
// differently and the difference is real, not cosmetic:
//   Stripe   → server returns a hosted-page URL; navigate to it.
//   Razorpay → the subscription already exists server-side; open Checkout.js
//              as an in-page modal against it, then ask the server to confirm.
// The server returns a discriminated union so this component branches on
// `kind` rather than guessing from a possibly-absent `url`.
//
// Access is NEVER granted from the modal's success callback — that is
// spoofable. The callback goes to billing.confirmCheckout, which re-verifies
// with Razorpay server-side, and the webhook remains the source of truth.

import React, { useState } from "react";
import { toast } from "sonner";
import { api } from "@/hooks/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRazorpayCheckout } from "./useRazorpayCheckout";
import { formatPlanPrice } from "./format";

export function PlansComparison() {
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  const utils = api.useUtils();
  const { data: plans, isLoading } = api.billing.getPlans.useQuery();
  const { data: currentPlan } = api.billing.getCurrentPlan.useQuery();
  const { data: providerInfo } = api.billing.getProviderInfo.useQuery();

  const createCheckout = api.billing.createCheckoutSession.useMutation();
  const confirmCheckout = api.billing.confirmCheckout.useMutation();
  const razorpay = useRazorpayCheckout();

  const handleSelectPlan = async (planId: string) => {
    setPendingPlan(planId);

    try {
      const handoff = await createCheckout.mutateAsync({
        planId,
        successUrl: `${window.location.origin}/dashboard/settings/billing?success=true`,
        cancelUrl: `${window.location.origin}/dashboard/settings/billing?canceled=true`,
      });

      if (handoff.kind === "redirect") {
        if (!handoff.url) {
          throw new Error("The payment provider did not return a checkout page.");
        }
        window.location.href = handoff.url;
        return; // navigating away; leave the button in its pending state
      }

      const result = await razorpay.open({
        keyId: handoff.keyId,
        subscriptionId: handoff.subscriptionId,
        description: handoff.description,
        prefill: handoff.prefill,
      });

      if (!result) {
        toast.info("Checkout cancelled. Your plan is unchanged.");
        return;
      }

      // Fast-path confirmation for UX only. If it cannot confirm right now the
      // webhook still will, so this reports honestly rather than claiming
      // either success or failure it cannot substantiate.
      const confirmation = await confirmCheckout.mutateAsync(result);

      if (confirmation.applied) {
        toast.success(`Payment received. You are now on the ${confirmation.planName} plan.`);
      } else {
        toast.success("Payment received. Your plan is being updated.");
      }

      await utils.billing.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start checkout. Please try again.",
      );
    } finally {
      setPendingPlan(null);
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
      {providerInfo && !providerInfo.configured && (
        <div className="mb-6 rounded-md border border-dharma-warning bg-dharma-warning-bg p-4 text-sm text-dharma-warning-text">
          Payments are not configured on this deployment, so upgrades are
          unavailable. Contact your administrator.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans?.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          const limits = plan.limits as Record<string, number>;
          const isPending = pendingPlan === plan.id;
          // Free has no provider plan and is not "unavailable" — it is simply
          // not something you check out. Anything else without a provider plan
          // genuinely cannot be sold and must not offer a button that fails.
          const isFree = plan.price === 0;
          const canBuy = plan.isSellable && providerInfo?.configured !== false;

          return (
            <Card key={plan.id} className={`relative flex flex-col ${isCurrent ? "border-dharma-accent border border-dharma-border" : ""}`}>
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-dharma-accent text-dharma-ink-inverse px-3 py-1 rounded-full text-xs font-semibold border border-dharma-border">
                    Current Plan
                  </span>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{plan.displayName}</CardTitle>
                <div className="mt-4 flex items-baseline">
                  {/* Currency comes from the Plan row, not a hardcoded "$" —
                      Razorpay India sells in INR and the original Stripe
                      prices were USD. Misstating a price to a paying customer
                      is not a cosmetic bug. */}
                  <span className="text-4xl font-bold tracking-tight">
                    {formatPlanPrice(plan.price, plan.currency)}
                  </span>
                  <span className="text-dharma-ink-secondary ml-1 text-sm font-medium">/month</span>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm">Top Features</h4>
                  <ul className="space-y-3">
                    {plan.features && Object.entries(plan.features)
                      .filter(([, enabled]) => enabled)
                      .slice(0, 4) // Show only up to 4 top features in card
                      .map(([key]) => (
                        <li key={key} className="flex items-start gap-3">
                          <CheckCircle className="w-5 h-5 text-dharma-accent-on-tint shrink-0" />
                          <span className="text-sm text-dharma-ink-secondary">{formatFeatureName(key)}</span>
                        </li>
                      ))
                    }
                  </ul>

                  <div className="mt-6 pt-6 border-t border-dharma-border space-y-3">
                    <p className="text-sm font-semibold">Usage Limits</p>
                    <ul className="space-y-2 text-sm text-dharma-ink-secondary">
                      <li className="flex justify-between">
                        <span>Users</span>
                        <span className="font-medium text-dharma-ink">{limits?.users || "Unlimited"}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Frameworks</span>
                        <span className="font-medium text-dharma-ink">{limits?.frameworks || "Unlimited"}</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Storage (MB)</span>
                        <span className="font-medium text-dharma-ink">{limits?.storageMb || "Unlimited"}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-2">
                <Button
                  className="w-full"
                  variant={isCurrent ? "secondary" : "default"}
                  disabled={isCurrent || isFree || !canBuy || isPending}
                  onClick={() => void handleSelectPlan(plan.id)}
                >
                  {isCurrent
                    ? "Current Plan"
                    : isFree
                      ? "Included"
                      : isPending
                        ? providerInfo?.checkoutStyle === "redirect"
                          ? "Redirecting…"
                          : "Opening checkout…"
                        : "Select Plan"}
                </Button>
                {/* An honest reason beats a disabled button with no
                    explanation — this is a real configuration gap an admin
                    can act on. */}
                {!isCurrent && !isFree && !plan.isSellable && (
                  <p className="text-xs text-dharma-ink-secondary">
                    Not yet available through this deployment&apos;s payment
                    provider. Contact support to upgrade.
                  </p>
                )}
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
                    const hasFeature = (plan.features as Record<string, boolean> | null)?.[feature];
                    return (
                      <TableCell key={plan.id} className="text-center">
                        {hasFeature ? (
                          <CheckCircle className="w-5 h-5 text-dharma-success-text mx-auto" />
                        ) : (
                          <XCircle className="w-5 h-5 text-dharma-ink-secondary mx-auto" />
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
