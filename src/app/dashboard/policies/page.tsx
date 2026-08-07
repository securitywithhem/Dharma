"use client";

/**
 * WAVE 7.3 — the policies list.
 *
 * Three defects from fullstack-audit-2026-08-06, all on one page:
 *
 *  * §6 HIGH-2 — a three-way state collapse. The page was
 *    `data?.map(...)` followed by `data?.length === 0 ? <Card/> : null`. While
 *    loading, `data` is undefined so BOTH branches render nothing and the page
 *    is a bare heading; on error, identical. This is the exact defect class
 *    WAVE 2.3 closed for Settings → General.
 *  * §4 CRITICAL — the cards were not links, so there was no route into a
 *    policy at all (the detail page did not exist either; it does now).
 *  * §4 HIGH-2 — the empty state was a Card with no link, no button and no CTA,
 *    and the page header had no "New Policy" action either. The only route into
 *    policies/new in the whole app was the dashboard's QuickActionsCard.
 */

import Link from "next/link";
import type { Route } from "next";
import { FileText, Plus, ShieldAlert } from "lucide-react";

import { api } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function PoliciesPage() {
  const policiesQuery = api.policy.list.useQuery();
  const capabilitiesQuery = api.user.capabilities.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const canCreate = capabilitiesQuery.isSuccess && capabilitiesQuery.data.policiesWrite;
  const policies = policiesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Policies</h1>
          <p className="text-dharma-ink-secondary">
            Keep the drafts your team needs for audits, customers, and internal reviews.
          </p>
        </div>

        {canCreate && (
          // `buttonVariants` rather than <Button asChild> — this Button has no
          // asChild prop, and wrapping a Link in a <button> would nest an
          // anchor inside a button.
          <Link
            href={"/dashboard/policies/new" as Route}
            className={cn(buttonVariants(), "shrink-0")}
          >
            <Plus className="mr-2 h-4 w-4" />
            New policy
          </Link>
        )}
      </div>

      {/* Loading — a distinct branch, so "nothing yet" is never shown for
          "we haven't asked yet". */}
      {policiesQuery.isPending && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error — the audit's §6 HIGH-1: an outage that renders as an empty list
          reads as a fact about the user's compliance posture. */}
      {policiesQuery.isError && (
        <Card className="border-dharma-danger bg-dharma-danger-bg">
          <CardHeader>
            <div className="flex items-center gap-2 text-dharma-danger-text">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle className="text-base">Failed to load policies</CardTitle>
            </div>
            <CardDescription>
              {policiesQuery.error?.message ?? "An unexpected error occurred."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => policiesQuery.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty — the shared component with a real primary action, not a
          hand-rolled Card whose text names a workflow it does not link to. */}
      {policiesQuery.isSuccess && policies.length === 0 && (
        <EmptyState
          icon={FileText}
          title="No policies yet"
          description="Start from a DPDP-aligned template, review the draft, and publish it."
          action={canCreate ? { label: "New policy", href: "/dashboard/policies/new" } : undefined}
        />
      )}

      {policiesQuery.isSuccess && policies.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {policies.map((policy) => (
            // The whole card is the link. Previously nothing here was
            // clickable, which is what made a generated policy unreachable.
            <Link
              key={policy.id}
              href={`/dashboard/policies/${policy.id}` as Route}
              className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors hover:border-dharma-accent">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{policy.title}</CardTitle>
                      <CardDescription>
                        {policy.policyType.replaceAll("_", " ")}
                      </CardDescription>
                    </div>
                    <Badge variant={policy.isPublished ? "success" : "outline"}>
                      {policy.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Still a clamped preview, but of the markdown SOURCE — the
                      body is markdown and rendering it here would mean a second
                      renderer on the list. Three lines of source is a
                      recognisable excerpt, which is all a list row needs. */}
                  <p className="line-clamp-3 whitespace-pre-line text-sm text-dharma-ink-secondary">
                    {policy.content}
                  </p>
                  <p className="text-xs uppercase tracking-[0.2em] text-dharma-ink-secondary">
                    Version {policy.version}
                    {policy.publishedAt
                      ? ` · Published ${new Date(policy.publishedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
