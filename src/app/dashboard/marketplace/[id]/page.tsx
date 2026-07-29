"use client";

import React, { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import { api as trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, Tag, ArrowLeft, Download, Star } from "lucide-react";
import { ReviewSection } from "@/components/marketplace/ReviewSection";
import { ImportModal } from "@/components/marketplace/ImportModal";
import Link from "next/link";

export default function MarketplaceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [showImportModal, setShowImportModal] = useState(false);

  const { data: item, isLoading } = trpc.marketplace.getItem.useQuery(
    { identifier: id },
    { enabled: !!id }
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-32">
        <Loader2 className="h-10 w-10 animate-spin text-dharma-accent-on-tint" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="text-center py-20 bg-dharma-surface rounded-xl border border-dashed border-dharma-border mt-8">
        <p className="text-dharma-ink-secondary text-lg mb-4">Item not found</p>
        <Button onClick={() => router.push("/dashboard/marketplace" as any)} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Marketplace
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <Link href={"/dashboard/marketplace" as any} className="inline-flex items-center text-sm text-dharma-ink-secondary hover:text-dharma-ink transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-10">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start gap-6">
            <div className="h-32 w-32 shrink-0 bg-dharma-surface from-primary/5 to-primary/10 rounded-2xl flex items-center justify-center relative overflow-hidden border border-dharma-border">
              {item.logoUrl ? (
                <Image
                  src={item.logoUrl}
                  alt={item.name}
                  fill
                  className="object-contain p-4 mix-blend-multiply"
                />
              ) : (
                <Tag className="h-12 w-12 text-dharma-accent-on-tint" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-4xl font-bold text-dharma-ink tracking-tight">
                {item.name}
              </h1>
              <p className="text-dharma-ink-secondary mt-2 text-lg">
                Version {item.version}
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <Badge variant="secondary" className="px-3 py-1 text-sm font-medium">
                  {item.category}
                </Badge>
                <Badge variant="outline" className="px-3 py-1 text-sm">
                  {item.type}
                </Badge>
              </div>
            </div>
          </div>

          {/* Description */}
          <Card className="p-8 border border-dharma-border">
            <h2 className="text-xl font-semibold text-dharma-ink mb-4">
              About this item
            </h2>
            <div className="prose prose-sm sm:prose-base max-w-none text-dharma-ink-secondary whitespace-pre-wrap leading-relaxed">
              {item.description}
            </div>
          </Card>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-6 text-center border border-dharma-border">
              <p className="text-sm font-medium text-dharma-ink-secondary mb-1">Downloads</p>
              <p className="text-3xl font-bold text-dharma-ink flex items-center justify-center gap-2">
                <Download className="h-6 w-6 text-dharma-accent-on-tint" />
                {item.downloads}
              </p>
            </Card>
            <Card className="p-6 text-center border border-dharma-border">
              <p className="text-sm font-medium text-dharma-ink-secondary mb-1">Published By</p>
              <p className="text-xl font-semibold text-dharma-ink mt-2 line-clamp-1">
                {item.author?.name || "Dharma"}
              </p>
            </Card>
          </div>

          {/* Reviews */}
          <ReviewSection itemId={item.id} reviews={item.reviews} />
        </div>

        {/* Sidebar */}
        <aside className="lg:col-span-1">
          <Card className="p-6 sticky top-24 border border-dharma-border border-dharma-accent">
            <div className="mb-6">
              <p className="text-sm font-medium text-dharma-ink-secondary mb-2">Price</p>
              <p className="text-4xl font-bold text-dharma-ink">
                {item.price === 0 ? "Free" : `$${(item.price / 100).toFixed(2)}`}
              </p>
            </div>

            <Button
              size="lg"
              onClick={() => setShowImportModal(true)}
              className="w-full font-semibold text-md h-12"
            >
              Import to My Org
            </Button>
            
            <p className="text-xs text-center text-dharma-ink-secondary mt-3">
              Requires active billing profile
            </p>

            {/* Stats */}
            <div className="mt-8 pt-8 border-t border-dharma-border space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-dharma-ink-secondary text-sm">Rating</span>
                <span className="font-semibold flex items-center gap-1.5">
                  <Star className="h-4 w-4 fill-dharma-warning text-dharma-ink" />
                  {item.ratings ? item.ratings.toFixed(1) : "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-dharma-ink-secondary text-sm">Reviews</span>
                <span className="font-semibold">{item.reviewCount || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-dharma-ink-secondary text-sm">Last Updated</span>
                <span className="font-semibold text-sm">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <div className="mt-8 pt-8 border-t border-dharma-border">
                <p className="text-sm font-medium text-dharma-ink-secondary mb-3">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-xs bg-dharma-surface-hover hover:bg-dharma-surface-hover">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          item={{
            id: item.id,
            name: item.name,
            price: item.price,
            type: item.type
          }}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
