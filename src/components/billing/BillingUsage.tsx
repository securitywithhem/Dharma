"use client";

import React from "react";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { Skeleton } from "@/components/ui/skeleton";
import { UsageBar } from "./UsageBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function BillingUsage() {
  const { usageStats, isLoading, error } = useEntitlements();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !usageStats) {
    return <div className="text-dharma-danger-text">Failed to load usage data.</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current Usage</CardTitle>
          <CardDescription>
            Your organization's current usage across the available limits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-4">
            <UsageBar
              label="Users"
              current={usageStats.users.current}
              limit={usageStats.users.limit}
              percent={usageStats.users.percent}
              isNearLimit={usageStats.users.isNearLimit}
              isOverLimit={usageStats.users.isOverLimit}
              format="number"
            />
            <UsageBar
              label="Frameworks"
              current={usageStats.frameworks.current}
              limit={usageStats.frameworks.limit}
              percent={usageStats.frameworks.percent}
              isNearLimit={usageStats.frameworks.isNearLimit}
              isOverLimit={usageStats.frameworks.isOverLimit}
              format="number"
            />
            <UsageBar
              label="Storage"
              current={usageStats.storage.current}
              limit={usageStats.storage.limit}
              percent={usageStats.storage.percent}
              isNearLimit={usageStats.storage.isNearLimit}
              isOverLimit={usageStats.storage.isOverLimit}
              format="bytes"
            />
          </div>
        </CardContent>
      </Card>

      {/* Usage Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Breakdown</CardTitle>
          <CardDescription>
            Detailed view of your limits based on the {usageStats.planName} plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead className="text-center">Current</TableHead>
                <TableHead className="text-center">Limit</TableHead>
                <TableHead className="text-center">Usage %</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { key: "users", label: "Users", data: usageStats.users },
                { key: "frameworks", label: "Frameworks", data: usageStats.frameworks },
                { key: "storage", label: "Storage (MB)", data: usageStats.storage },
              ].map(({ key, label, data }) => {
                const isCritical = data.isOverLimit;
                const isWarning = data.isNearLimit && !data.isOverLimit;

                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="text-center text-dharma-ink-secondary">{data.current}</TableCell>
                    <TableCell className="text-center text-dharma-ink-secondary">
                      {data.limit === 0 ? "Unlimited" : data.limit}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`text-sm font-semibold ${
                          isCritical
                            ? "text-dharma-danger-text"
                            : isWarning
                            ? "text-dharma-ink"
                            : "text-dharma-success-text"
                        }`}
                      >
                        {data.limit === 0 ? "0" : Math.min(data.percent, 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {isCritical ? (
                        <Badge variant="destructive">Critical</Badge>
                      ) : isWarning ? (
                        <Badge variant="warning">Warning</Badge>
                      ) : (
                        <Badge variant="success">Healthy</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          
          <p className="mt-6 text-xs text-dharma-ink-secondary flex items-center gap-1">
            <span className="text-lg">💡</span> Usage is calculated in real-time. If you're nearing a limit, consider upgrading your plan.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
