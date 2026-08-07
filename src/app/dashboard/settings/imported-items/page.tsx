"use client";

import React from "react";
import { toast } from "sonner";
import { api as trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import Link from "next/link";

export default function ImportedItemsPage() {
  const { data: items, isLoading, refetch } = trpc.import.getImportedItems.useQuery();

  // WAVE 9.4 (§6 MEDIUM-2) — the shared ConfirmDialog, not window.confirm.
  // The native dialog is unstyled, unbranded, blocks the main thread, and
  // cannot say what is about to be destroyed in more than one line of plain
  // text. confirm-dialog.tsx was built in b0199f1 for exactly this and was
  // being used in only three places.
  const [pendingRemoval, setPendingRemoval] = React.useState<
    { id: string; name: string } | null
  >(null);

  const unimportMutation = trpc.import.unimportFramework.useMutation({
    onSuccess: () => {
      toast.success("Framework removed.");
      setPendingRemoval(null);
      refetch();
    },
    onError: (error: { message: string }) => {
      // toast rather than alert(), same reasoning as the dialog.
      toast.error(`Failed to remove: ${error.message}`);
      setPendingRemoval(null);
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Imported Frameworks</h1>
        <p className="text-dharma-ink-secondary mt-2">
          Manage frameworks and templates you've imported from the marketplace.
        </p>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-dharma-accent-on-tint" />
        </div>
      ) : (
        <div className="space-y-4">
          {items && items.length > 0 ? (
            items.map((item: any) => (
              <div
                key={item.id}
                className="bg-dharma-surface border border-dharma-border rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-dharma-border"
              >
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-dharma-ink">
                    {item.itemName}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">{item.itemType}</Badge>
                    <span className="text-sm text-dharma-ink-secondary border-l border-dharma-border pl-2">
                      v{item.itemVersion}
                    </span>
                    {item.sourceItem && (
                      <span className="text-sm text-dharma-ink-secondary border-l border-dharma-border pl-2">
                        By {item.sourceItem.author?.name || "Unknown"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dharma-ink-secondary mt-3">
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
                    onClick={() => setPendingRemoval({ id: item.id, name: item.itemName })}
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
            <div className="text-center py-16 bg-dharma-surface-hover rounded-lg border border-dashed border-dharma-border">
              <p className="text-dharma-ink-secondary mb-4">
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
      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
        title="Remove this imported framework?"
        description={
          <>
            <strong>{pendingRemoval?.name}</strong> will be removed from your
            organization. This deletes the copied framework and all of its
            controls, along with any evidence mapped to them.
          </>
        }
        confirmLabel="Remove framework"
        pending={unimportMutation.isPending}
        onConfirm={() =>
          pendingRemoval && unimportMutation.mutate({ importedItemId: pendingRemoval.id })
        }
      />

    </div>
  );
}
