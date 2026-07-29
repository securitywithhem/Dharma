"use client";

import React, { useState } from "react";
import { api as trpc } from "@/lib/trpc";
import { MarketplaceGrid } from "@/components/marketplace/MarketplaceGrid";
import { MarketplaceSidebar } from "@/components/marketplace/MarketplaceSidebar";
import { Loader2 } from "lucide-react";
import type { ItemType } from "@prisma/client";

export default function MarketplacePage() {
  const [filters, setFilters] = useState({
    category: "",
    type: "" as ItemType | "",
    sortBy: "recent" as "rating" | "downloads" | "recent",
    page: 1,
  });

  const {
    data: itemsData,
    isLoading,
  } = trpc.marketplace.getPublicItems.useQuery(
    {
      take: 20,
      skip: (filters.page - 1) * 20,
      category: filters.category || undefined,
      type: (filters.type as ItemType) || undefined,
      search: undefined, // Add if we implement a search bar later
    }
  );

  const { data: categories } = trpc.marketplace.getCategories.useQuery();
  const { data: featured } = trpc.marketplace.getFeatured.useQuery();

  const handleFilterChange = (newFilters: any) => {
    setFilters(newFilters);
  };

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Marketplace</h1>
        <p className="text-dharma-ink-secondary mt-2">
          Browse and import compliance frameworks, templates, and connectors.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar with Filters */}
        <aside className="lg:col-span-1">
          <MarketplaceSidebar
            categories={categories || []}
            currentFilters={filters}
            onFilterChange={handleFilterChange}
          />
        </aside>

        {/* Main Content */}
        <div className="lg:col-span-3">
          <div className="space-y-10">
            {/* Featured Section (on page 1) */}
            {filters.page === 1 && !filters.category && !filters.type && featured && featured.length > 0 && (
              <div>
                <h2 className="text-2xl font-semibold text-dharma-ink mb-4">
                  ⭐ Featured
                </h2>
                <MarketplaceGrid items={featured as any} />
              </div>
            )}

            {/* Search Results */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-dharma-ink">
                  All Items
                </h2>
                {itemsData && (
                  <p className="text-sm text-dharma-ink-secondary">
                    {itemsData.total} results
                  </p>
                )}
              </div>

              {isLoading ? (
                <div className="flex justify-center items-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-dharma-accent-on-tint" />
                </div>
              ) : itemsData?.items && itemsData.items.length > 0 ? (
                <>
                  <MarketplaceGrid items={itemsData.items as any} />

                  {/* Pagination */}
                  <div className="mt-10 flex justify-between items-center border-t border-dharma-border pt-6">
                    <button
                      onClick={() =>
                        handleFilterChange({
                          ...filters,
                          page: Math.max(1, filters.page - 1),
                        })
                      }
                      disabled={filters.page === 1}
                      className="px-4 py-2 border border-dharma-border-strong rounded-md text-sm font-medium transition-colors hover:bg-dharma-accent hover:text-dharma-ink-inverse disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      &larr; Previous
                    </button>

                    <span className="text-sm text-dharma-ink-secondary font-medium">
                      Page {filters.page} of {Math.max(1, Math.ceil((itemsData.count || 0) / 20))}
                    </span>

                    <button
                      onClick={() =>
                        handleFilterChange({
                          ...filters,
                          page: filters.page + 1,
                        })
                      }
                      disabled={filters.page >= Math.ceil((itemsData.count || 0) / 20)}
                      className="px-4 py-2 border border-dharma-border-strong rounded-md text-sm font-medium transition-colors hover:bg-dharma-accent hover:text-dharma-ink-inverse disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next &rarr;
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-20 bg-dharma-surface rounded-xl border border-dashed border-dharma-border">
                  <p className="text-dharma-ink-secondary text-lg mb-2">No items found</p>
                  <p className="text-sm text-dharma-ink-secondary">Try adjusting your filters to see more results.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
