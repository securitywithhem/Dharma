"use client";

import React from "react";
import { api as trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import Link from "next/link";

export default function ImportedItemsPage() {
  const { data: items, isLoading, refetch } = trpc.import.getImportedItems.useQuery();

  const unimportMutation = trpc.import.unimportFramework.useMutation({
    onSuccess: () => {
      refetch();
    },
    onError: (error: any) => {
      alert(`Failed to remove: ${error.message}`);
    }
  });

  const handleRemove = (id: string, name: string) => {
    if (confirm(`Are you sure you want to remove "${name}" from your organization? This will delete the copied framework and all its data.`)) {
      unimportMutation.mutate({ importedItemId: id });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Imported Frameworks</h1>
        <p className="text-muted-foreground mt-2">
          Manage frameworks and templates you've imported from the marketplace.
        </p>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-4">
          {items && items.length > 0 ? (
            items.map((item: any) => (
              <div
                key={item.id}
                className="bg-card border border-border rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
              >
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground">
                    {item.itemName}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">{item.itemType}</Badge>
                    <span className="text-sm text-muted-foreground border-l border-border pl-2">
                      v{item.itemVersion}
                    </span>
                    {item.sourceItem && (
                      <span className="text-sm text-muted-foreground border-l border-border pl-2">
                        By {item.sourceItem.author?.name || "Unknown"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Imported on {new Date(item.importedAt).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {item.importedFrameworkId && (
                    <Button variant="outline">
                      <Link href={`/dashboard/frameworks/${item.importedFrameworkId}` as any}>
                        View Framework
                      </Link>
                    </Button>
                  )}

                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleRemove(item.id, item.itemName)}
                    disabled={unimportMutation.isPending}
                    title="Remove Import"
                  >
                    {unimportMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-16 bg-muted/30 rounded-lg border border-dashed border-border">
              <p className="text-muted-foreground mb-4">
                You haven't imported any frameworks yet.
              </p>
              <Button variant="outline">
                <Link href={"/dashboard/marketplace" as any}>
                  Browse Marketplace
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
