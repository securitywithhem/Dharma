"use client";

// Phase 3c — self-serve subscription management.
//
// Razorpay has no hosted Billing Portal for status, payment methods and
// cancellation, so leaving a "Manage billing" button pointing at one would
// produce a control that opens nothing. Everything such a portal would do —
// status, payment-method replacement, cancellation, billing details — is here,
// in-app.
//
// Cancellation routes through the shared ConfirmDialog. That is not ceremony:
// this codebase already established that irreversible actions get a confirm
// step (reports and schedules have no soft-delete), and cancelling a
// subscription immediately re-applies the Free plan's limits — losing seats and
// framework slots is exactly as unrecoverable by a click.

import React, { useState } from "react";
import { toast } from "sonner";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CreditCard } from "lucide-react";
import { useRazorpayCheckout } from "./useRazorpayCheckout";
import { formatDate, formatPlanPrice } from "./format";

/** Provider status strings → a badge tone the page can use consistently. */
function statusTone(status: string | null): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "active":
    case "authenticated":
      return "success";
    case "past_due":
    case "pending":
    case "halted":
    case "created":
      return "warning";
    case "cancelled":
    case "canceled":
    case "expired":
      return "destructive";
    default:
      return "secondary";
  }
}

export function BillingManage() {
  const utils = api.useUtils();

  const { data: subscription, isLoading: subLoading } = api.billing.getSubscription.useQuery();
  const { data: providerInfo } = api.billing.getProviderInfo.useQuery();
  const { data: billingDetails } = api.billing.getBillingDetails.useQuery();

  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [gstin, setGstin] = useState<string | null>(null);

  const razorpay = useRazorpayCheckout();
  const confirmCheckout = api.billing.confirmCheckout.useMutation();

  const cancel = api.billing.cancelSubscription.useMutation({
    onSuccess: async () => {
      setConfirmingCancel(false);
      toast.success("Subscription cancelled. Your organization is now on the Free plan.");
      await utils.billing.invalidate();
    },
    onError: (error) => {
      setConfirmingCancel(false);
      toast.error(error.message);
    },
  });

  const startMethodUpdate = api.billing.startPaymentMethodUpdate.useMutation();

  const saveDetails = api.billing.updateBillingDetails.useMutation({
    onSuccess: async () => {
      toast.success("Billing details saved.");
      await utils.billing.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const handleUpdatePaymentMethod = async () => {
    try {
      const handoff = await startMethodUpdate.mutateAsync();

      const result = await razorpay.open({
        keyId: handoff.keyId,
        subscriptionId: handoff.subscriptionId,
        description: handoff.description,
        prefill: handoff.prefill,
      });

      if (!result) {
        // The customer backed out. Their existing mandate is untouched — the
        // replacement subscription was created but never authorised, and the
        // reconciliation worker will notice it never activated.
        toast.info("Payment method unchanged.");
        await utils.billing.invalidate();
        return;
      }

      await confirmCheckout.mutateAsync(result);
      toast.success("Payment method updated.");
      await utils.billing.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the payment method.",
      );
    }
  };

  if (subLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const plan = subscription?.plan ?? null;
  const isPaid = Boolean(plan && plan.price > 0);
  const currentGstin = gstin ?? billingDetails?.gstin ?? "";

  return (
    <div className="space-y-6">
      {/* Provider could not be reached — say so rather than presenting stale
          numbers as current. */}
      {subscription?.stale && (
        <div className="flex items-start gap-3 rounded-md border border-dharma-warning bg-dharma-warning-bg p-4 text-sm text-dharma-warning-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Live billing status is temporarily unavailable. The details below are
            Dharma&apos;s last known state and may be out of date.
          </p>
        </div>
      )}

      {subscription?.delinquentSince && (
        <div className="flex items-start gap-3 rounded-md border border-dharma-danger bg-dharma-danger-bg p-4 text-sm text-dharma-danger-text">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A payment failed on {formatDate(subscription.delinquentSince)}. Update
            your payment method to keep your current plan.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            Your current plan, its status, and what happens next.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Plan</span>
            <span className="text-sm text-dharma-ink">
              {plan?.displayName ?? "Free"}
              {plan && plan.price > 0 && (
                <span className="text-dharma-ink-secondary">
                  {" "}
                  — {formatPlanPrice(plan.price, plan.currency)}/month
                </span>
              )}
            </span>
          </div>

          {subscription?.status && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <Badge variant={statusTone(subscription.status)}>
                {subscription.status.toUpperCase()}
              </Badge>
            </div>
          )}

          {subscription?.currentPeriodEnd && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {subscription.canceledAt ? "Access until" : "Renews on"}
              </span>
              <span className="text-sm text-dharma-ink-secondary">
                {formatDate(subscription.currentPeriodEnd)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Billed through</span>
            <span className="text-sm text-dharma-ink-secondary">Razorpay</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment method</CardTitle>
          <CardDescription>
            {/* Honest about the mechanism, because the customer will see a
                payment screen and should know why. */}
            Razorpay ties your payment mandate to your subscription, so updating
            your method re-authorises it. Your plan and billing date are
            unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isPaid ? (
            <p className="text-sm text-dharma-ink-secondary">
              You are on the Free plan. There is no payment method to manage.
            </p>
          ) : (
            <Button
              variant="secondary"
              className="gap-2"
              disabled={startMethodUpdate.isPending || razorpay.isOpening}
              onClick={() => void handleUpdatePaymentMethod()}
            >
              <CreditCard className="h-4 w-4" />
              {startMethodUpdate.isPending || razorpay.isOpening
                ? "Opening…"
                : "Update payment method"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing details</CardTitle>
          <CardDescription>
            Optional. Recorded on your organization for invoicing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="gstin">GSTIN</Label>
          <Input
            id="gstin"
            value={currentGstin}
            placeholder="22AAAAA0000A1Z5"
            onChange={(event) => setGstin(event.target.value.toUpperCase())}
          />
          <p className="text-xs text-dharma-ink-secondary">
            Indian GST identification number, if your organization is registered.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            disabled={saveDetails.isPending}
            onClick={() =>
              saveDetails.mutate({ gstin: currentGstin.trim() === "" ? null : currentGstin.trim() })
            }
          >
            {saveDetails.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>

      {isPaid && (
        <Card className="border-dharma-danger">
          <CardHeader>
            <CardTitle>Cancel subscription</CardTitle>
            <CardDescription>
              Your organization moves to the Free plan immediately. Your data is
              kept, but Free plan limits re-apply.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel subscription
            </Button>
          </CardFooter>
        </Card>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title="Cancel your subscription?"
        description={
          <>
            Billing stops now and your organization moves to the Free plan
            immediately. Nothing is deleted, but Free plan limits re-apply — if
            you are over them, you will not be able to add more until you are
            back within the limits. Resubscribing later is a new subscription.
          </>
        }
        confirmLabel={cancel.isPending ? "Cancelling…" : "Cancel subscription"}
        cancelLabel="Keep my plan"
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}
