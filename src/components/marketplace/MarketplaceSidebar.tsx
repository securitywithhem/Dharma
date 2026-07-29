"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";

interface MarketplaceSidebarProps {
  categories: Array<{ name: string; count: number }>;
  currentFilters: {
    category: string;
    type: string;
    sortBy: "rating" | "downloads" | "recent";
    page: number;
  };
  onFilterChange: (filters: MarketplaceSidebarProps["currentFilters"]) => void;
}

export function MarketplaceSidebar({
  categories,
  currentFilters,
  onFilterChange,
}: MarketplaceSidebarProps) {
  return (
    <div className="space-y-6 sticky top-20 bg-dharma-surface rounded-lg border border-dharma-border p-5">
      {/* Sort */}
      <div>
        <h3 className="font-semibold text-dharma-ink mb-3 text-sm">Sort By</h3>
        <select
          value={currentFilters.sortBy}
          onChange={(e) =>
            onFilterChange({
              ...currentFilters,
              sortBy: e.target.value as any,
              page: 1,
            })
          }
          className="w-full h-10 rounded-md border border-dharma-border-strong bg-dharma-bg px-3 py-2 text-sm ring-offset-dharma-bg focus:outline-none focus:ring-2 focus:ring-dharma-accent focus:ring-offset-2"
        >
          <option value="recent">Most Recent</option>
          <option value="downloads">Most Downloaded</option>
          <option value="rating">Highest Rated</option>
        </select>
      </div>

      {/* Type Filter */}
      <div>
        <h3 className="font-semibold text-dharma-ink mb-3 text-sm">Type</h3>
        <div className="space-y-2">
          {["FRAMEWORK", "TEMPLATE", "CONNECTOR"].map((type) => (
            <label key={type} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="type"
                value={type}
                checked={currentFilters.type === type}
                onChange={(e) =>
                  onFilterChange({
                    ...currentFilters,
                    type: e.target.value,
                    page: 1,
                  })
                }
                className="w-4 h-4 text-dharma-accent-on-tint focus:ring-dharma-accent border-dharma-border"
              />
              <span className="text-sm text-dharma-ink-secondary">{type}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="type"
              value=""
              checked={currentFilters.type === ""}
              onChange={() => onFilterChange({ ...currentFilters, type: "", page: 1 })}
              className="w-4 h-4 text-dharma-accent-on-tint focus:ring-dharma-accent border-dharma-border"
            />
            <span className="text-sm text-dharma-ink-secondary">All Types</span>
          </label>
        </div>
      </div>

      {/* Category Filter */}
      <div>
        <h3 className="font-semibold text-dharma-ink mb-3 text-sm">Categories</h3>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-2">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() =>
                onFilterChange({
                  ...currentFilters,
                  category: currentFilters.category === cat.name ? "" : cat.name,
                  page: 1,
                })
              }
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                currentFilters.category === cat.name
                  ? "bg-dharma-accent-tint text-dharma-accent-on-tint font-medium"
                  : "text-dharma-ink-secondary hover:bg-dharma-surface-hover"
              }`}
            >
              <span className="flex justify-between items-center">
                <span>{cat.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {cat.count}
                </Badge>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Clear Filters */}
      {(currentFilters.category || currentFilters.type) && (
        <button
          onClick={() =>
            onFilterChange({
              category: "",
              type: "",
              sortBy: "recent",
              page: 1,
            })
          }
          className="w-full text-dharma-accent-on-tint hover:text-dharma-accent-on-tint text-sm font-medium transition-colors"
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}
