"use client";

// Phase 3b/3c — Billing History.
//
// Previously rendered a hard-coded "Invoice #INV-001 / $99.00 / today" row
// whenever a subscription was active, with a Download button wired to nothing,
// plus a fabricated "Subscription Created" timeline dated to page-load. In a
// compliance product, invented financial records are worse than an empty
// state: everything here comes from the payment provider via
// billing.listInvoices, and the invented timeline card is gone — the real
// subscription history lives in the audit log, which is authoritative and
// already exposed elsewhere. Phase 3c kept that standard while making the
// source provider-agnostic; nothing on this page is ever synthesised locally.
import React from "react";
import { api } from "@/hooks/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink } from "lucide-react";
import { formatDate, formatMinorUnits } from "./format";

function invoiceBadgeVariant(status: string | null) {
  // Covers Razorpay's invoice vocabulary
  // (paid/issued/partially_paid/expired/cancelled).
  if (status === "paid") return "success" as const;
  if (status === "open" || status === "draft" || status === "issued") {
    return "secondary" as const;
  }
  if (status === "partially_paid") return "warning" as const;
  return "destructive" as const;
}

export function BillingHistory() {
  const invoicesQuery = api.billing.listInvoices.useQuery();

  if (invoicesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const invoices = invoicesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            Invoices are issued by Razorpay each time your subscription
            renews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoicesQuery.isError ? (
            <div className="rounded-md border border-dharma-danger bg-dharma-danger-bg p-4 text-sm text-dharma-danger-text">
              <p>Could not load invoices from Razorpay.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void invoicesQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-md border border-dashed bg-dharma-surface-hover p-4 text-sm text-dharma-ink-secondary">
              No invoices yet. Your first invoice will appear after your first
              payment.
            </div>
          ) : (
            <ul className="space-y-4">
              {invoices.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex flex-col justify-between gap-4 border-b pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {invoice.number ?? "Invoice"}
                      </p>
                      <Badge variant={invoiceBadgeVariant(invoice.status)}>
                        {invoice.status?.toUpperCase() ?? "UNKNOWN"}
                      </Badge>
                    </div>
                    <p className="text-xs text-dharma-ink-secondary">
                      Billed on {formatDate(invoice.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold">
                      {formatMinorUnits(invoice.amountDue, invoice.currency)}
                    </span>
                    {/* Each control is rendered only when Razorpay actually
                        returned the corresponding link. A download button that
                        cannot download, or a "PDF" link that opens a web page,
                        is worse than its absence. Razorpay commonly returns a
                        hosted page and no PDF, in which case the invoice shows
                        "View" and no download. */}
                    {invoice.invoicePdf && (
                      <a
                        href={invoice.invoicePdf}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm" className="gap-2">
                          <Download className="h-4 w-4" />
                          Download PDF
                        </Button>
                      </a>
                    )}
                    {!invoice.invoicePdf && invoice.hostedInvoiceUrl && (
                      <a
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm" className="gap-2">
                          <ExternalLink className="h-4 w-4" />
                          View invoice
                        </Button>
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The old "Manage Payment Methods" card lived here and opened a hosted
          portal. Razorpay has no equivalent, so payment methods, cancellation
          and billing details all live on the Manage tab instead. */}
    </div>
  );
}
