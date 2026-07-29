import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Star, Download, Tag } from "lucide-react";
import type { ItemType } from "@prisma/client";

interface MarketplaceItem {
  id: string;
  name: string;
  shortDescription?: string | null;
  description: string;
  category: string;
  type: ItemType;
  price: number;
  ratings?: number;
  reviewCount?: number;
  downloads: number;
  logoUrl?: string | null;
  author?: {
    name: string | null;
  };
  tags: string[];
}

interface MarketplaceGridProps {
  items: MarketplaceItem[];
}

export function MarketplaceGrid({ items }: MarketplaceGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/dashboard/marketplace/${item.id}` as any}
          className="group flex flex-col h-full bg-dharma-surface rounded-xl border border-dharma-border overflow-hidden hover:border border-dharma-border hover:border-dharma-accent transition-all duration-150 ease-out"
        >
          {/* Logo/Image */}
          <div className="h-40 bg-dharma-surface from-primary/5 to-primary/10 flex items-center justify-center relative overflow-hidden border-b border-dharma-border">
            {item.logoUrl ? (
              <Image
                src={item.logoUrl}
                alt={item.name}
                fill
                className="object-contain p-4 mix-blend-multiply"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-dharma-accent-on-tint">
                <Tag className="h-10 w-10 mb-2" />
                <span className="text-xs font-medium uppercase tracking-wider">{item.type}</span>
              </div>
            )}
            <div className="absolute top-3 right-3 flex gap-2">
              <Badge variant="secondary" className="bg-dharma-bg border-0 font-medium">
                {item.category}
              </Badge>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 flex flex-col flex-1">
            <h3 className="font-semibold text-lg text-dharma-ink line-clamp-1 group-hover:text-dharma-accent-on-tint transition-colors">
              {item.name}
            </h3>

            <p className="text-sm text-dharma-ink-secondary mt-2 line-clamp-2 flex-1 leading-relaxed">
              {item.shortDescription || item.description.slice(0, 100) + "..."}
            </p>

            {/* Meta */}
            <div className="mt-4 pt-4 border-t border-dharma-border flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-dharma-warning text-dharma-ink" />
                  <span className="text-sm font-medium text-dharma-ink">
                    {item.ratings ? item.ratings.toFixed(1) : "New"}
                  </span>
                  <span className="text-xs text-dharma-ink-secondary">
                    ({item.reviewCount || 0})
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 text-dharma-ink-secondary">
                  <Download className="h-4 w-4" />
                  <span className="text-xs">{item.downloads}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-dharma-ink-secondary truncate mr-2">
                  By {item.author?.name || "Dharma"}
                </span>
                <span className="text-sm font-semibold text-dharma-ink whitespace-nowrap">
                  {item.price === 0 ? "Free" : `$${(item.price / 100).toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
