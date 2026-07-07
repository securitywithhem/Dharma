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
          className="group flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden hover:shadow-md hover:border-primary/50 transition-all duration-200"
        >
          {/* Logo/Image */}
          <div className="h-40 bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center relative overflow-hidden border-b border-border/50">
            {item.logoUrl ? (
              <Image
                src={item.logoUrl}
                alt={item.name}
                fill
                className="object-contain p-4 mix-blend-multiply"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-primary/40">
                <Tag className="h-10 w-10 mb-2" />
                <span className="text-xs font-medium uppercase tracking-wider">{item.type}</span>
              </div>
            )}
            <div className="absolute top-3 right-3 flex gap-2">
              <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm border-0 font-medium">
                {item.category}
              </Badge>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 flex flex-col flex-1">
            <h3 className="font-semibold text-lg text-foreground line-clamp-1 group-hover:text-primary transition-colors">
              {item.name}
            </h3>

            <p className="text-sm text-muted-foreground mt-2 line-clamp-2 flex-1 leading-relaxed">
              {item.shortDescription || item.description.slice(0, 100) + "..."}
            </p>

            {/* Meta */}
            <div className="mt-4 pt-4 border-t border-border/50 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="text-sm font-medium text-foreground">
                    {item.ratings ? item.ratings.toFixed(1) : "New"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({item.reviewCount || 0})
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Download className="h-4 w-4" />
                  <span className="text-xs">{item.downloads}</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground truncate mr-2">
                  By {item.author?.name || "Dharma"}
                </span>
                <span className="text-sm font-semibold text-foreground whitespace-nowrap">
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
