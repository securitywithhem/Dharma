"use client";

import React from "react";
import { api } from "@/hooks/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";

export function BillingHistory() {
  const { data: subscription, isLoading } = api.billing.getSubscription.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Invoices Section */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            View and download your billing invoices below. Invoices are automatically generated when your subscription renews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Mock invoices – in a real implementation, these would be fetched from a Stripe API endpoint */}
            {subscription?.status === "active" ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 gap-4">
                <div>
                  <p className="text-sm font-medium">Invoice #INV-001</p>
                  <p className="text-xs text-dharma-ink-secondary">
                    Billed on {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())}
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-semibold">$99.00</span>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Download className="w-4 h-4" />
                    Download PDF
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-dharma-ink-secondary bg-dharma-surface-hover p-4 rounded-md border border-dashed">
                No invoices yet. Your first invoice will appear after your first payment.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Subscription History */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription History</CardTitle>
          <CardDescription>
            A timeline of your subscription changes and events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <p className="text-sm font-medium">Subscription Created</p>
                <p className="text-xs text-dharma-ink-secondary">
                  {subscription?.status 
                    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date())
                    : "No active subscription"}
                </p>
              </div>
              <Badge variant={subscription?.status === "active" ? "success" : "secondary"}>
                {subscription?.status?.toUpperCase() || "INACTIVE"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods Section */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>
            To manage your payment methods, please visit your Stripe customer portal or contact support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="gap-2">
            Manage Payment Methods
            <ExternalLink className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
