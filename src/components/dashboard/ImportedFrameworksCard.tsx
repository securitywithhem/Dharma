"use client";

import React from "react";
import Link from "next/link";
import { api as trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Download } from "lucide-react";

export function ImportedFrameworksCard() {
  const { data: items, isLoading } = trpc.import.getImportedItems.useQuery();

  if (isLoading || !items || items.length === 0) {
    return null;
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Download className="h-5 w-5 text-dharma-accent-on-tint" />
          Recently Imported
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.slice(0, 3).map((item: any) => (
            <li key={item.id} className="flex justify-between items-center group">
              <div className="flex min-w-0 flex-col">
                {/* Import names are user-supplied and unbounded. */}
                <span className="truncate text-sm font-medium text-dharma-ink">{item.itemName}</span>
                <span className="truncate text-xs text-dharma-ink-secondary">
                  Imported {new Date(item.importedAt).toLocaleDateString()}
                </span>
              </div>
              {item.importedFrameworkId && (
                <Link
                  href={`/dashboard/frameworks/${item.importedFrameworkId}`}
                  className="text-xs font-medium text-dharma-accent-on-tint opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  View
                </Link>
              )}
            </li>
          ))}
        </ul>

        <Link
          href={"/dashboard/settings/imported-items" as any}
          className="inline-flex items-center text-sm font-medium text-dharma-ink-secondary hover:text-dharma-accent-on-tint transition-colors mt-4 pt-4 border-t border-dharma-border w-full"
        >
          Manage imports
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
